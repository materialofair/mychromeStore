export const NETWORK_MESSAGE = 'SPACE_NETWORK';
export const NETWORK_KEY = 'spaceNetworkLog';
export const LIMITS = { records: 200, body: 256000, metadata: 32000, total: 2000000 };

export function trustedNetworkSender(api, sender) {
  // Extension pages opened in a tab also have sender.tab; the exact extension
  // URL and runtime id distinguish them from injected page content scripts.
  return sender?.id === api.runtime.id && sender.url === api.runtime.getURL('sidepanel.html');
}

export function createNetworkRecorder(api, limits = LIMITS) {
  let log = null, chains = new Map(), pending = new Set(), used = 0;
  let queue = Promise.resolve(), saveQueue = Promise.resolve(), saveTimer;
  const command = (tabId, method, params = {}) => api.debugger.sendCommand({ tabId }, method, params);
  const snapshot = () => log ? structuredClone(log) : null;

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const value = snapshot();
    saveQueue = saveQueue.catch(() => {}).then(() => value
      ? api.storage.session.set({ [NETWORK_KEY]: value }) : api.storage.session.remove(NETWORK_KEY));
    return saveQueue;
  }
  function changed() {
    if (!saveTimer) saveTimer = setTimeout(() => {
      saveTimer = null;
      void persist().catch(() => { if (log) log.note = '会话缓存写入失败，请立即导出；关闭侧栏或后台重启可能丢失日志。'; });
    }, 400);
  }
  const ready = (async () => {
    const stored = (await api.storage.session.get(NETWORK_KEY))[NETWORK_KEY];
    if (!stored) return;
    log = stored;
    // Never silently resume capture after a worker interruption.
    if (['recording', 'starting', 'stopping'].includes(log.status)) {
      log.status = 'stopped'; log.stoppedAt = new Date().toISOString();
      log.note = '后台重新启动，记录已中断；最后一次缓存后的数据可能丢失。';
      for (const record of log.records) if (record.responseBodyNote === '等待响应完成') record.responseBodyNote = '后台中断，正文未获取';
      try { await api.debugger.detach({ tabId: log.tabId }); } catch { /* Target may already be detached. */ }
      await persist();
    }
  })();

  function keep(value, limit, record, label) {
    const text = String(value ?? '');
    const available = Math.max(0, Math.min(limit, limits.total - used));
    const result = text.slice(0, available);
    used += result.length;
    if (result.length < text.length) record.notes.push(`${label}已截断（单项或日志总量上限）`);
    return result;
  }
  function headers(value, record, label) {
    const result = Object.create(null);
    const raw = JSON.stringify(value || {});
    if (raw.length > limits.metadata || used + raw.length > limits.total) {
      record.notes.push(`${label}未保存：超过元数据或日志总量上限`);
      return result;
    }
    used += raw.length;
    for (const [key, text] of Object.entries(value || {})) result[key] = text;
    return result;
  }
  function mergeHeaders(base, extra) {
    const result = { ...base };
    for (const [key, value] of Object.entries(extra)) {
      for (const existing of Object.keys(result)) if (existing.toLowerCase() === key.toLowerCase()) delete result[existing];
      Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
    }
    return result;
  }
  function extras(chain) {
    // ExtraInfo can arrive before or after base events, including redirects.
    for (const record of chain.records) {
      if (record.expectsExtra === undefined) break;
      if (!record.expectsExtra) continue;
      if (!record.requestExtra && chain.requestExtras.length) {
        record.requestHeaders = mergeHeaders(record.requestHeaders, chain.requestExtras.shift());
        record.requestExtra = true;
      }
      if (!record.responseExtra && chain.responseExtras.length) {
        const extra = chain.responseExtras.shift();
        record.responseHeaders = mergeHeaders(record.responseHeaders, extra.headers);
        record.status = extra.statusCode; record.responseExtra = true;
      }
      if (!record.requestExtra || !record.responseExtra) break;
    }
  }
  function response(record, value, timestamp) {
    record.status = value.status; record.mimeType = value.mimeType || '';
    record.responseHeaders = headers(value.headers, record, '响应头');
    if (timestamp != null) record.durationMs = Math.max(0, Math.round((timestamp - record.timestamp) * 1000));
  }
  function asyncBody(record, method, field, noteField) {
    const owner = log;
    const task = command(log.tabId, method, { requestId: record.requestId }).then(result => {
      if (log !== owner || !['recording', 'stopping'].includes(owner.status)) return;
      if (field === 'requestBody' && chains.get(record.requestId)?.records.at(-1) !== record) {
        record[noteField] = '重定向后请求体无法可靠关联，未保存'; return;
      }
      if (result.base64Encoded) { record[noteField] = '浏览器返回 Base64 正文，本版不解码二进制内容'; return; }
      const text = result.body ?? result.postData;
      if (typeof text !== 'string') { record[noteField] = '浏览器未提供正文'; return; }
      record[field] = keep(text, limits.body, record, field === 'requestBody' ? '请求体' : '响应正文');
      record[noteField] = record[field].length < text.length ? '正文已截断，非完整内容' : '已获取浏览器提供的正文';
    }).catch(() => {
      if (log === owner && ['recording', 'stopping'].includes(owner.status)) record[noteField] = '浏览器未提供正文（缓存、已释放、上传文件或请求中断等）';
    }).finally(() => { pending.delete(task); changed(); });
    pending.add(task);
  }
  function handleEvent(source, method, params) {
    if (!log || log.status !== 'recording' || source.tabId !== log.tabId || source.sessionId || !method.startsWith('Network.')) return;
    const id = params.requestId;
    if (!id) return;
    let chain = chains.get(id);
    if (!chain) {
      if (!['Network.requestWillBeSent', 'Network.requestWillBeSentExtraInfo', 'Network.responseReceivedExtraInfo'].includes(method)) return;
      if (chains.size >= limits.records) {
        autoStop('已达到请求数量上限，自动停止记录。'); return;
      }
      chain = { records: [], requestExtras: [], responseExtras: [], notes: [] }; chains.set(id, chain);
    }
    if (method === 'Network.requestWillBeSent') {
      if (!/^https?:\/\//i.test(params.request.url)) return;
      if (log.records.length >= limits.records || used >= limits.total) {
        autoStop('已达到请求数量或日志总量上限，自动停止记录。'); return;
      }
      const previous = chain.records.at(-1);
      if (previous && params.redirectResponse) {
        response(previous, params.redirectResponse, params.timestamp);
        previous.expectsExtra = !!params.redirectHasExtraInfo;
        previous.responseBodyNote = '重定向响应，不读取正文';
      }
      const record = { id: `${log.records.length + 1}`, requestId: id, timestamp: params.timestamp,
        time: new Date((params.wallTime || Date.now() / 1000) * 1000).toISOString(),
        notes: chain.notes, method: params.request.method, type: params.type || 'Other',
        requestHeaders: {}, responseHeaders: {}, requestBodyNote: '无请求体或浏览器未提供', responseBodyNote: '等待响应完成' };
      record.url = keep(params.request.url, limits.metadata, record, 'URL');
      record.requestHeaders = headers(params.request.headers, record, '请求头');
      if (typeof params.request.postData === 'string') {
        record.requestBody = keep(params.request.postData, limits.body, record, '请求体');
        record.requestBodyNote = record.requestBody.length < params.request.postData.length ? '请求体已截断' : '已获取浏览器提供的请求体（上传文件字节可能省略）';
      } else if (params.request.hasPostData) {
        record.requestBodyNote = '等待获取请求体'; asyncBody(record, 'Network.getRequestPostData', 'requestBody', 'requestBodyNote');
      }
      chain.records.push(record); log.records.push(record); extras(chain);
    } else if (method === 'Network.requestWillBeSentExtraInfo') {
      if (chain.requestExtras.length >= limits.records) return;
      const record = chain.records.at(-1) || chain;
      chain.requestExtras.push(headers(params.headers, record, '额外请求头')); extras(chain);
    } else if (method === 'Network.responseReceivedExtraInfo') {
      if (chain.responseExtras.length >= limits.records) return;
      const record = chain.records.at(-1) || chain;
      chain.responseExtras.push({ headers: headers(params.headers, record, '额外响应头'), statusCode: params.statusCode }); extras(chain);
    } else {
      const record = chain.records.at(-1);
      if (!record) return;
      if (method === 'Network.responseReceived') {
        response(record, params.response);
        record.expectsExtra = !!params.hasExtraInfo; extras(chain);
      } else if (method === 'Network.loadingFinished') {
        record.durationMs = Math.max(0, Math.round((params.timestamp - record.timestamp) * 1000));
        if (record.method === 'HEAD' || [204, 304].includes(record.status)) record.responseBodyNote = '该响应无正文或仅使用缓存';
        else if (/^(text\/|application\/(.*json|.*xml|javascript|x-www-form-urlencoded))/.test(record.mimeType || '') || ['Fetch', 'XHR'].includes(record.type)) {
          asyncBody(record, 'Network.getResponseBody', 'responseBody', 'responseBodyNote');
        } else record.responseBodyNote = '非文本响应，本版不读取正文';
      } else if (method === 'Network.loadingFailed') {
        record.failure = keep(params.errorText || '请求失败', limits.metadata, record, '错误');
        record.durationMs = Math.max(0, Math.round((params.timestamp - record.timestamp) * 1000));
        record.responseBodyNote = '请求失败，未获取响应正文';
        if (chain.records.length === 1 && chain.requestExtras.length) {
          record.requestHeaders = mergeHeaders(record.requestHeaders, chain.requestExtras.shift()); record.requestExtra = true;
        }
      }
    }
    changed();
  }

  function autoStop(reason) {
    void dispatch({ action: 'stop', reason }).catch(() => {
      if (log) log.note = '记录已停止，但会话缓存失败，请立即导出。';
    });
  }

  async function stop(reason = '用户停止记录') {
    if (!log || !['recording', 'starting'].includes(log.status)) return snapshot();
    const owner = log;
    log.status = 'stopping';
    let timer;
    await Promise.race([Promise.allSettled([...pending]), new Promise(resolve => { timer = setTimeout(resolve, 2000); })]);
    clearTimeout(timer);
    // A request stopped before responseReceived has no hasExtraInfo flag yet.
    // A single hop still permits unambiguous attribution of its request headers.
    for (const chain of chains.values()) {
      const record = chain.records[0];
      if (chain.records.length === 1 && !record.requestExtra && chain.requestExtras.length) {
        record.requestHeaders = mergeHeaders(record.requestHeaders, chain.requestExtras.shift());
        record.requestExtra = true;
      }
    }
    owner.status = 'stopped'; owner.stoppedAt = new Date().toISOString(); owner.note = reason;
    for (const record of owner.records) {
      if (record.responseBodyNote === '等待响应完成') record.responseBodyNote = '停止时响应尚未完成或正文未获取';
      if (record.requestBodyNote === '等待获取请求体') record.requestBodyNote = '停止时请求体尚未获取';
    }
    try { await api.debugger.detach({ tabId: owner.tabId }); }
    catch { owner.note += '；调试连接已断开或无法解除，请检查浏览器调试提示。'; }
    await persist(); return snapshot();
  }
  async function execute(message) {
    await ready;
    if (message.action === 'get') return snapshot();
    if (message.action === 'stop') return stop(message.reason);
    if (message.action === 'clear') {
      if (log && ['recording', 'starting', 'stopping'].includes(log.status)) throw new Error('请先停止记录再清空');
      log = null; chains.clear(); used = 0; await persist(); return null;
    }
    if (message.action !== 'start') throw new Error('未知网络日志操作');
    if (log) throw new Error('请先导出并清空已有日志，再开始新记录');
    if (!Number.isInteger(message.tabId)) throw new Error('没有可记录的网页标签');
    const tab = await api.tabs.get(message.tabId);
    if (!/^https?:\/\//i.test(tab.url || '')) throw new Error('仅支持 HTTP(S) 网页，请切换到目标网页');
    log = { status: 'starting', tabId: tab.id, url: tab.url.slice(0, limits.metadata), title: (tab.title || '').slice(0, limits.metadata),
      startedAt: new Date().toISOString(), stoppedAt: null, note: '', records: [] };
    chains = new Map(); pending = new Set(); used = log.url.length + log.title.length;
    let attached = false;
    try {
      await api.debugger.attach({ tabId: tab.id }, '1.3'); attached = true;
      log.status = 'recording';
      await command(tab.id, 'Network.enable', { maxTotalBufferSize: 8000000, maxResourceBufferSize: 1000000, maxPostDataSize: limits.body });
      await persist(); return snapshot();
    } catch {
      if (attached) { try { await api.debugger.detach({ tabId: tab.id }); } catch { /* Already detached. */ } }
      log = null; await persist();
      throw new Error('无法开始记录：请检查 debugger 权限、浏览器企业策略或其他调试器占用');
    }
  }
  function dispatch(message) {
    const result = queue.then(() => execute(message));
    queue = result.catch(() => {}); return result;
  }
  api.debugger.onEvent.addListener(handleEvent);
  api.debugger.onDetach.addListener(source => {
    if (source.tabId === log?.tabId && ['recording', 'starting'].includes(log.status)) {
      autoStop('目标页关闭或调试连接断开，记录已停止');
    }
  });
  return { dispatch, ready };
}

export function installNetworkRecorder(api) {
  const recorder = createNetworkRecorder(api);
  api.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== NETWORK_MESSAGE) return;
    if (!trustedNetworkSender(api, sender)) { reply({ ok: false, error: '仅扩展侧栏可访问网络日志' }); return; }
    // No arbitrary CDP methods or target messages are accepted from the UI.
    recorder.dispatch({ action: message.action, tabId: message.tabId }).then(
      log => reply({ ok: true, log }), error => reply({ ok: false, error: error.message }));
    return true;
  });
}
