import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { createNetworkRecorder, trustedNetworkSender, LIMITS } = await import(String('../extensions/space-browsa/network/recorder.js'));
const { networkMarkdown, fence } = await import(String('../extensions/space-browsa/network/markdown.js'));
const { applyNetworkPatch } = await import(String('../extensions/space-browsa/network-patch.mjs'));

function harness(limits = LIMITS, stored: any = {}) {
  let onEvent: any, onDetach: any;
  const api = {
    runtime: { id: 'extension', getURL: (path: string) => `chrome-extension://extension/${path}` },
    tabs: { get: vi.fn(async (id: number) => ({ id, url: 'https://example.com/page', title: 'Page' })) },
    storage: { session: {
      get: vi.fn(async () => structuredClone(stored)),
      set: vi.fn(async (value: any) => { Object.assign(stored, structuredClone(value)); }),
      remove: vi.fn(async (key: string) => { delete stored[key]; }),
    } },
    debugger: {
      attach: vi.fn(async () => {}), detach: vi.fn(async () => {}),
      sendCommand: vi.fn(async (_target: any, method: string, _params: any) => method === 'Network.getResponseBody' ? { body: '{"ok":true,"token":"response-secret"}', base64Encoded: false } : { postData: 'name=value' }),
      onEvent: { addListener: (fn: any) => { onEvent = fn; } }, onDetach: { addListener: (fn: any) => { onDetach = fn; } },
    },
  };
  const recorder = createNetworkRecorder(api, limits);
  const event = (method: string, value: any = {}, source = { tabId: 7 }) => onEvent(source, `Network.${method}`, { requestId: 'r1', ...value });
  const request = (value: any = {}) => event('requestWillBeSent', { timestamp: 10, wallTime: 1700000000, type: 'Fetch', request: { url: 'https://example.com/api?q=1&q=2', method: 'POST', headers: { Accept: 'application/json' }, postData: '{"token":"request-secret"}' }, ...value });
  return { api, recorder, event, request, detached: () => onDetach({ tabId: 7 }),
    start: () => recorder.dispatch({ action: 'start', tabId: 7 }),
    stop: () => recorder.dispatch({ action: 'stop' }), get: () => recorder.dispatch({ action: 'get' }) };
}

describe('network capture and Markdown', () => {
  it('preserves credentials from ExtraInfo, formats query duplicates and both bodies without sending a model request', async () => {
    const h = harness(); await h.start();
    h.event('requestWillBeSentExtraInfo', { headers: { Cookie: 'session=raw-cookie', Authorization: 'Bearer raw-token' } });
    h.request();
    h.event('responseReceivedExtraInfo', { statusCode: 200, headers: { 'Set-Cookie': 'session=new-cookie', 'X-Token': 'response-token' } });
    h.event('responseReceived', { hasExtraInfo: true, response: { status: 200, mimeType: 'application/json', headers: {} } });
    h.event('loadingFinished', { timestamp: 10.25 });
    const log = await h.stop(), md = networkMarkdown(log);
    for (const value of ['raw-cookie', 'raw-token', 'new-cookie', 'request-secret', 'response-secret', 'response-token']) expect(md).toContain(value);
    expect(log.records[0].durationMs).toBe(250);
    expect(md).toContain('"q",\n    "1"'); expect(md).toContain('"q",\n    "2"');
    expect(h.api.debugger.detach).toHaveBeenCalledOnce();
    expect(h.api.storage.session.set).toHaveBeenCalled();
  });
  it('ignores other tabs and child sessions and records nothing after stop', async () => {
    const h = harness(); await h.start();
    h.event('requestWillBeSent', { request: { url: 'https://other.example/', method: 'GET' } }, { tabId: 9 });
    h.event('requestWillBeSent', { request: { url: 'https://frame.example/', method: 'GET' } }, { tabId: 7, sessionId: 'child' } as any);
    h.request(); const log = await h.stop(); h.request({ requestId: 'late' });
    expect(log.records).toHaveLength(1); expect((await h.get()).records).toHaveLength(1);
    expect(log.records[0].responseBodyNote).toContain('停止');
  });
  it('keeps extra request headers when stopped before any response', async () => {
    const h = harness(); await h.start(); h.request();
    h.event('requestWillBeSentExtraInfo', { headers: { Cookie: 'pending-cookie' } });
    expect((await h.stop()).records[0].requestHeaders.Cookie).toBe('pending-cookie');
  });
  it('does not misattribute late post data to an earlier redirect hop', async () => {
    const h = harness(); await h.start();
    let resolvePost!: (value: any) => void;
    h.api.debugger.sendCommand.mockImplementation(async () => await new Promise<any>(resolve => { resolvePost = resolve; }));
    h.request({ request: { url: 'https://example.com/before', method: 'POST', headers: {}, hasPostData: true } });
    h.request({ timestamp: 11, redirectResponse: { status: 302, headers: {} }, request: { url: 'https://example.com/after', method: 'GET', headers: {} } });
    resolvePost({ postData: 'ambiguous payload' });
    const log = await h.stop();
    expect(log.records[0].requestBody).toBeUndefined(); expect(log.records[0].requestBodyNote).toContain('无法可靠关联');
  });
  it('associates delayed redirect extra headers with the correct hop', async () => {
    const h = harness(); await h.start(); h.request();
    h.request({ timestamp: 10.1, redirectHasExtraInfo: true, redirectResponse: { status: 302, headers: { Location: '/next' } }, request: { url: 'https://example.com/next', method: 'GET', headers: {} } });
    h.event('responseReceived', { hasExtraInfo: true, response: { status: 200, mimeType: 'text/plain', headers: {} } });
    h.event('requestWillBeSentExtraInfo', { headers: { Cookie: 'first' } });
    h.event('requestWillBeSentExtraInfo', { headers: { Cookie: 'second' } });
    h.event('responseReceivedExtraInfo', { statusCode: 302, headers: { 'X-Hop': 'first' } });
    h.event('responseReceivedExtraInfo', { statusCode: 200, headers: { 'X-Hop': 'second' } });
    const log = await h.stop();
    expect(log.records.map((r: any) => [r.status, r.requestHeaders.Cookie, r.responseHeaders['X-Hop']])).toEqual([[302, 'first', 'first'], [200, 'second', 'second']]);
    expect(log.records[0].responseBodyNote).toContain('重定向');
  });
  it('marks body read failures, failed requests, binary responses and truncation explicitly', async () => {
    const h = harness({ ...LIMITS, body: 8 }); await h.start(); h.request();
    h.event('responseReceived', { response: { status: 200, mimeType: 'application/json', headers: {} } });
    h.event('loadingFinished', { timestamp: 11 });
    await vi.waitFor(async () => expect((await h.get()).records[0].responseBodyNote).toContain('截断'));
    h.request({ requestId: 'failed' }); h.event('loadingFailed', { requestId: 'failed', timestamp: 11, errorText: 'net::ERR_FAILED' });
    h.request({ requestId: 'binary', type: 'Image' });
    h.event('responseReceived', { requestId: 'binary', response: { status: 200, mimeType: 'image/png', headers: {} } });
    h.event('loadingFinished', { requestId: 'binary', timestamp: 11 });
    h.api.debugger.sendCommand.mockRejectedValue(new Error('No resource'));
    h.request({ requestId: 'missing' });
    h.event('responseReceived', { requestId: 'missing', response: { status: 200, mimeType: 'text/plain', headers: {} } });
    h.event('loadingFinished', { requestId: 'missing', timestamp: 11 });
    const log = await h.stop();
    expect(log.records[0].requestBodyNote).toContain('截断');
    expect(log.records[1].failure).toBe('net::ERR_FAILED');
    expect(log.records[2].responseBodyNote).toContain('非文本');
    expect(log.records[3].responseBodyNote).toContain('未提供');
  });
  it('stops on record limit and does not silently overwrite previous logs', async () => {
    const h = harness({ ...LIMITS, records: 1 }); await h.start(); h.request(); h.request({ requestId: 'r2' });
    const log = await h.get(); expect(log.status).toBe('stopped'); expect(log.records).toHaveLength(1);
    await expect(h.start()).rejects.toThrow('清空');
    await h.recorder.dispatch({ action: 'clear' }); expect(await h.get()).toBeNull();
  });
  it('serializes concurrent starts and refuses clear while recording', async () => {
    const h = harness(); const starts = await Promise.allSettled([h.start(), h.start()]);
    expect(starts.map(s => s.status)).toEqual(['fulfilled', 'rejected']);
    expect(h.api.debugger.attach).toHaveBeenCalledOnce();
    await expect(h.recorder.dispatch({ action: 'clear' })).rejects.toThrow('停止'); await h.stop();
  });
  it('shows actionable attach error and allows retry', async () => {
    const h = harness(); h.api.debugger.attach.mockRejectedValueOnce(new Error('policy'));
    await expect(h.start()).rejects.toThrow('企业策略'); expect(await h.get()).toBeNull();
    await h.start(); await h.stop();
  });
  it('retains stopped data even when the session cache fails', async () => {
    const h = harness(); await h.start(); h.request();
    h.api.storage.session.set.mockRejectedValue(new Error('Quota exceeded'));
    await expect(h.stop()).rejects.toThrow('Quota exceeded');
    const log = await h.get(); expect(log.status).toBe('stopped'); expect(log.records).toHaveLength(1);
    expect(h.api.debugger.detach).toHaveBeenCalledOnce();
    h.api.storage.session.set.mockResolvedValue();
  });
  it('times out pending body retrieval and ignores its late result after clear and restart', async () => {
    const h = harness(); await h.start(); h.request();
    let resolveBody!: (value: any) => void;
    h.api.debugger.sendCommand.mockImplementation(async (_target: any, method: string) => method === 'Network.getResponseBody'
      ? await new Promise<any>(resolve => { resolveBody = resolve; }) : {} as any);
    h.event('responseReceived', { response: { status: 200, mimeType: 'text/plain', headers: {} } });
    h.event('loadingFinished', { timestamp: 11 });
    const stopped = await h.stop(); expect(stopped.records[0].responseBodyNote).toContain('停止');
    await h.recorder.dispatch({ action: 'clear' }); await h.start();
    resolveBody({ body: 'late secret' }); await Promise.resolve();
    expect((await h.get()).records).toHaveLength(0); await h.stop();
  });
  it('retrieves omitted post data and marks Base64 content instead of pretending it is text', async () => {
    const h = harness(); await h.start();
    h.request({ request: { url: 'https://example.com/form', method: 'POST', headers: {}, hasPostData: true } });
    await vi.waitFor(async () => expect((await h.get()).records[0].requestBody).toBe('name=value'));
    h.api.debugger.sendCommand.mockResolvedValue({ body: 'AAEC', base64Encoded: true });
    h.event('responseReceived', { response: { status: 200, mimeType: 'application/octet-stream', headers: {} } });
    h.event('loadingFinished', { timestamp: 11 });
    expect((await h.stop()).records[0].responseBodyNote).toContain('Base64');
  });
  it('marks omitted oversized headers and never silently treats them as complete', async () => {
    const h = harness({ ...LIMITS, metadata: 100 }); await h.start();
    h.event('requestWillBeSentExtraInfo', { headers: { Cookie: 'x'.repeat(200) } }); h.request();
    h.event('responseReceived', { hasExtraInfo: true, response: { status: 200, mimeType: 'text/plain', headers: {} } });
    const log = await h.stop(); expect(networkMarkdown(log)).toContain('额外请求头未保存');
    expect(log.records[0].requestHeaders.Cookie).toBeUndefined();
  });
  it('stops on detach and recovers interrupted cached logs without resuming capture', async () => {
    const h = harness(); await h.start(); h.request(); h.detached();
    expect((await h.get()).note).toContain('连接断开');
    const cached = { spaceNetworkLog: { ...await h.get(), status: 'recording' } };
    const recovered = harness(LIMITS, cached); const log = await recovered.get();
    expect(log.status).toBe('stopped'); expect(log.note).toContain('后台重新启动');
    expect(recovered.api.debugger.attach).not.toHaveBeenCalled();
  });
  it('restricts access to the extension sidebar, not content scripts, web pages or the store bridge', () => {
    const h = harness();
    expect(trustedNetworkSender(h.api, { id: 'extension', url: 'chrome-extension://extension/sidepanel.html' })).toBe(true);
    expect(trustedNetworkSender(h.api, { id: 'extension', url: 'chrome-extension://extension/sidepanel.html', tab: { id: 7 } })).toBe(true);
    for (const sender of [{}, { id: 'other', url: 'chrome-extension://extension/sidepanel.html' },
      { id: 'extension', url: 'https://example.com/', tab: { id: 7 } }, { id: 'extension', url: 'chrome-extension://extension/options.html' }]) expect(trustedNetworkSender(h.api, sender)).toBe(false);
  });
  it('fences hostile content, exports only selected requests and includes analysis only when supplied', async () => {
    const h = harness(); await h.start(); h.request(); h.request({ requestId: 'second' });
    const log = await h.stop(); log.records[0].responseBody = '```\n<img src=x onerror=alert(1)>\n# injected';
    const md = networkMarkdown(log, ['1']); expect(md).toContain('````text'); expect(md).not.toContain('## 请求 2');
    expect(md).not.toContain('分析备注'); expect(networkMarkdown(log, [], 'analysis')).toContain('分析备注');
    expect(fence('````')).toBe('`````\n````\n`````');
  });
  it('fails before patching when upstream anchors change', async () => {
    const work = await mkdtemp(join(tmpdir(), 'network-anchor-'));
    try {
      await writeFile(join(work, 'manifest.json'), '{"permissions":[]}');
      await writeFile(join(work, 'background.js'), 'changed upstream');
      await expect(applyNetworkPatch(work)).rejects.toThrow('anchor mismatch');
      expect(await readFile(join(work, 'manifest.json'), 'utf8')).toBe('{"permissions":[]}');
      expect(await readFile(join(work, 'background.js'), 'utf8')).toBe('changed upstream');
    } finally { await rm(work, { recursive: true, force: true }); }
  });
});
