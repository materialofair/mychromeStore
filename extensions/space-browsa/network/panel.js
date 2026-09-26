import { networkMarkdown } from './markdown.js';

export function mountNetworkPanel({ getTabId, attachDocument }) {
  const open = document.createElement('button');
  open.id = 'space-network-open'; open.type = 'button'; open.textContent = '网络日志';
  open.className = 'iconbtn'; open.title = '记录当前网页请求并导出 Markdown';
  document.querySelector('.topbar').after(open);
  const dialog = document.createElement('dialog');
  dialog.id = 'space-network';
  // Static markup only; all captured data is rendered with textContent.
  dialog.innerHTML = `<div class="space-network-heading"><h2>网络请求日志</h2><button type="button" data-action="close">关闭</button></div>
    <p>手动记录目标页的 HTTP(S) 请求。Cookie、Authorization、Token 保留原值。</p>
    <p class="space-network-help">开始后操作或刷新网页。日志暂存在浏览器内存，重启浏览器或重载扩展会清除，请及时导出。单次最多 200 条，正文每项最多 256,000 字符，总采集文本最多 2,000,000 字符。</p>
    <div class="space-network-actions"><button type="button" data-action="start">开始记录当前页</button><button type="button" data-action="stop">停止记录</button><button type="button" data-action="clear">清空日志</button></div>
    <p data-status role="status" aria-live="polite"></p><p data-error role="alert"></p>
    <div class="space-network-actions"><button type="button" data-action="all">全选</button><button type="button" data-action="none">取消全选</button><button type="button" data-action="export-all">导出全部 MD</button><button type="button" data-action="export-selected">导出选中 MD</button><button type="button" data-action="attach">选中请求附加到对话</button></div>
    <p class="space-network-help">附加不会自动发送；点击聊天发送后，选中请求的原值会交给当前模型。跨进程 iframe、独立 Worker 和 WebSocket 帧暂不采集。</p>
    <div data-records></div>
    <label class="space-network-analysis">分析备注（可选，可粘贴 AI 分析；不改变原始日志）<textarea data-analysis rows="3" maxlength="100000"></textarea></label>
    <label><input type="checkbox" data-include-analysis> 导出时附带分析备注</label>`;
  document.body.append(dialog);
  const status = dialog.querySelector('[data-status]'), error = dialog.querySelector('[data-error]');
  const list = dialog.querySelector('[data-records]');
  let log = null, busy = false, timer, selected = new Set(), rendered = '';
  const button = action => dialog.querySelector(`[data-action="${action}"]`);
  const active = () => log && ['starting', 'recording', 'stopping'].includes(log.status);
  const ids = () => [...selected];
  async function request(action) {
    const reply = await chrome.runtime.sendMessage({ type: 'SPACE_NETWORK', action, tabId: getTabId() });
    if (!reply?.ok) throw new Error(reply?.error || '网络日志后台没有响应');
    if (log?.startedAt !== reply.log?.startedAt) {
      selected.clear(); dialog.querySelector('[data-analysis]').value = '';
    }
    log = reply.log;
  }
  function render() {
    open.textContent = active() ? '● 网络日志' : '网络日志';
    status.textContent = log ? `${active() ? '记录中' : '已停止'} · ${log.records.length} 条 · ${selected.size} 条选中\n目标：${log.url}\n${log.note || '切换标签页不会改变记录目标。'}` : '尚未记录；请在目标网页打开侧栏，然后开始记录。';
    button('start').disabled = busy || !!log;
    button('stop').disabled = busy || !active();
    button('clear').disabled = busy || !log || !!active();
    for (const action of ['export-all', 'export-selected', 'attach', 'all', 'none']) {
      button(action).disabled = busy || !!active() || !log?.records.length || (['export-selected', 'attach'].includes(action) && !selected.size);
    }
    // Keep selection and open details intact across recording status polls.
    const key = log ? `${log.startedAt}/${log.status}/${log.records.length}` : '';
    if (key === rendered) return;
    rendered = key; list.replaceChildren();
    if (!log) return;
    if (active()) { list.textContent = '正在采集，停止后可查看详情和导出。'; return; }
    for (const record of log.records) {
      const row = document.createElement('div'); row.className = 'space-network-record';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = record.id;
      checkbox.checked = selected.has(record.id); checkbox.setAttribute('aria-label', `选择请求 ${record.id}`);
      checkbox.addEventListener('change', () => { checkbox.checked ? selected.add(record.id) : selected.delete(record.id); render(); });
      const details = document.createElement('details'), summary = document.createElement('summary');
      summary.textContent = `${record.method} · ${record.status ?? '未获取状态'} · ${record.durationMs ?? '?'} ms\n${record.url}`;
      details.append(summary);
      details.addEventListener('toggle', () => {
        if (details.open && !details.querySelector('pre')) {
          const pre = document.createElement('pre'); pre.textContent = networkMarkdown(log, [record.id]); details.append(pre);
        }
      });
      row.append(checkbox, details); list.append(row);
    }
  }
  function markdown(all = false, includeAnalysis = true) {
    if (!log || active()) throw new Error('请先停止记录');
    return networkMarkdown(log, all ? null : ids(), includeAnalysis && dialog.querySelector('[data-include-analysis]').checked ? dialog.querySelector('[data-analysis]').value : '');
  }
  function filename() { return `space-network-${log.startedAt.replace(/[:.]/g, '-')}.md`; }
  async function act(action) {
    if (action === 'close') { dialog.close(); return; }
    if (busy) return;
    busy = true; error.textContent = ''; render();
    try {
      if (['start', 'stop', 'clear'].includes(action)) {
        await request(action);
        if (action === 'clear') { selected.clear(); dialog.querySelector('[data-analysis]').value = ''; }
      } else if (action === 'all' || action === 'none') {
        selected = new Set(action === 'all' ? log.records.map(record => record.id) : []); rendered = '';
      } else if (action.startsWith('export-')) {
        const text = markdown(action === 'export-all');
        const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename();
        document.body.append(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else if (action === 'attach') {
        const text = markdown(false, false);
        if (text.length > 100000) throw new Error('选中日志超过对话附件的 100,000 字符上限，请减少选择；完整内容仍可导出');
        await attachDocument(new File([text], filename(), { type: 'text/markdown' }));
        dialog.close();
      }
    } catch (cause) { error.textContent = cause.message || '操作失败，请重试'; }
    finally { busy = false; render(); }
  }
  dialog.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action) void act(action);
  });
  async function refresh() {
    if (busy) return;
    try { await request('get'); render(); } catch (cause) { error.textContent = cause.message; }
  }
  open.addEventListener('click', () => { dialog.showModal(); void refresh(); clearInterval(timer); timer = setInterval(refresh, 1500); });
  dialog.addEventListener('close', () => { clearInterval(timer); open.focus(); });
  render();
}
