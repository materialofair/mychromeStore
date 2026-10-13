export function validateToolPayload(value, maxBytes = 128 * 1024) {
  const stack = [{ value, depth:0 }], seen = new Set(); let count=0, size=0;
  while(stack.length) {
    const {value:v,depth}=stack.pop();
    if(++count>10000 || depth>16) throw new Error('Tool data is too complex');
    if(v===null || typeof v==='boolean') {size+=5;continue;}
    if(typeof v==='number') {if(!Number.isFinite(v))throw new Error('Tool data requires finite numbers');size+=24;continue;}
    if(typeof v==='string') {size+=new TextEncoder().encode(v).length;if(size>maxBytes)throw new Error('Tool data exceeds its budget');continue;}
    if(!v || typeof v!=='object' || seen.has(v) || (!Array.isArray(v) && Object.getPrototypeOf(v)!==Object.prototype && Object.getPrototypeOf(v)!==null))throw new Error('Tool data must be acyclic JSON');
    seen.add(v);const keys=Object.keys(v);if(keys.length>5000)throw new Error('Too many tool fields');
    if(Array.isArray(v) && (Object.getPrototypeOf(v)!==Array.prototype || v.length>5000 || keys.length!==v.length || keys.some((k,i)=>k!==String(i))))throw new Error('Tool arrays must be dense and bounded');
    for(const k of keys) {if(['__proto__','prototype','constructor'].includes(k))throw new Error('Invalid tool field');size+=k.length;stack.push({value:v[k],depth:depth+1});}
    if(size>maxBytes)throw new Error('Tool data exceeds its budget');
  }
  const text=JSON.stringify(value);if(new TextEncoder().encode(text).length>maxBytes)throw new Error('Tool data exceeds its budget');
  return JSON.parse(text);
}

// Runs only in the generated, opaque-origin child. No extension capability is injected.
export function installToolSdk(initial, instance) {
  const nativeTimeout = window.setTimeout.bind(window), nativeClear = window.clearTimeout.bind(window);
  const nativeInterval = window.setInterval.bind(window), nativeClearInterval = window.clearInterval.bind(window);
  const nativeRaf = window.requestAnimationFrame.bind(window), nativeCancelRaf = window.cancelAnimationFrame.bind(window);
  const send = (type, extra = {}) => parent.postMessage({ type, version: 3, instance, ...extra }, '*');
  let data = initial?.data ?? null, result = initial?.result ?? null, seq = 0, timer, inflight = false, dirty = false, paused = false;
  const waiters = [], pending = new Map(), pauseHooks = new Set(), timeouts = new Set(), intervals = new Set(), frames = new Set();
  function clone(value) {
    const text = JSON.stringify(value, (_, v) => {
      if (typeof v === 'function' || typeof v === 'bigint' || typeof v === 'symbol' || typeof v === 'undefined' || (typeof v === 'number' && !Number.isFinite(v))) throw new Error('State must be finite JSON data');
      return v;
    });
    if (!text || text.length > 60000) throw new Error('State is too large (60,000 characters)');
    return JSON.parse(text);
  }
  function fields() {
    const all = [...document.querySelectorAll('input,select,textarea')].slice(0, 200);
    return all.filter(el => !['password', 'file', 'hidden'].includes(el.type));
  }
  const fieldKey = (el, i) => `field-${i}-${el.id || el.name || 'unnamed'}`.slice(0, 120);
  function forms() {
    return Object.fromEntries(fields().map((el, i) => [fieldKey(el, i), ['checkbox', 'radio'].includes(el.type) ? el.checked : String(el.value).slice(0, 4096)]));
  }
  const snapshot = () => clone({ data, forms: forms(), result });
  function fail(error) { send('SPACE_TOOL_ERROR', { error: String(error?.message || error).slice(0, 400) }); }
  function flush() {
    nativeClear(timer); timer = null;
    if (inflight || !dirty) return;
    dirty = false; inflight = true;
    const request = ++seq, batch = waiters.splice(0);
    const timeout = nativeTimeout(() => {
      if (!pending.has(request)) return;
      pending.delete(request); inflight = false;
      const error = new Error('State save timed out'); batch.forEach(w => w.reject(error)); fail(error);
      if (dirty) flush();
    }, 5000);
    pending.set(request, { batch, timeout });
    try { send('SPACE_TOOL_SAVE', { request, state: snapshot() }); }
    catch (e) { nativeClear(timeout); pending.delete(request); inflight = false; batch.forEach(w => w.reject(e)); fail(e); }
  }
  function queueSave() { dirty = true; nativeClear(timer); timer = nativeTimeout(flush, 120); }
  function pause() {
    paused = true;
    for (const id of timeouts) nativeClear(id);
    for (const id of intervals) nativeClearInterval(id);
    for (const id of frames) nativeCancelRaf(id);
    timeouts.clear(); intervals.clear(); frames.clear();
    for (const fn of pauseHooks) { try { fn(); } catch (e) { fail(e); } }
    queueSave(); flush();
  }
  // These cover ordinary cooperative timers. They cannot interrupt synchronous JS.
  window.setTimeout = (fn, delay = 0, ...args) => {
    if (typeof fn !== 'function') throw new Error('Use function callbacks');
    if (paused) return 0;
    const id = nativeTimeout(() => { timeouts.delete(id); fn(...args); }, delay); timeouts.add(id); return id;
  };
  window.clearTimeout = id => { timeouts.delete(id); nativeClear(id); };
  window.setInterval = (fn, delay = 0, ...args) => {
    if (typeof fn !== 'function') throw new Error('Use function callbacks');
    if (paused) return 0;
    const id = nativeInterval(fn, Math.max(16, Number(delay) || 0), ...args); intervals.add(id); return id;
  };
  window.clearInterval = id => { intervals.delete(id); nativeClearInterval(id); };
  window.requestAnimationFrame = fn => {
    if (paused) return 0;
    const id = nativeRaf(t => { frames.delete(id); fn(t); }); frames.add(id); return id;
  };
  window.cancelAnimationFrame = id => { frames.delete(id); nativeCancelRaf(id); };
  for (const event of ['pointerdown', 'keydown']) document.addEventListener(event, e => { if (e.isTrusted) paused = false; }, true);
  const api = Object.freeze({
    loadState: async () => clone(data),
    saveState: value => { data = clone(value); queueSave(); return new Promise((resolve, reject) => waiters.push({ resolve, reject })); },
    setResult: value => {
      const next = clone(value);
      if (!next || typeof next.summary !== 'string' || next.summary.length > 4000 || !Object.hasOwn(next, 'data') || Object.keys(next).some(k => !['summary', 'data'].includes(k))) throw new Error('Result requires {summary, data}');
      result = next; queueSave();
    },
    onPause: fn => { if (typeof fn !== 'function') throw new Error('Expected callback'); pauseHooks.add(fn); return () => pauseHooks.delete(fn); },
  });
  Object.defineProperty(window, 'spaceTool', { value: api, writable: false, configurable: false });
  window.addEventListener('message', e => {
    const d = e.data;
    if (e.source !== parent || !d || typeof d !== 'object' || d.version !== 3 || d.instance !== instance) return;
    if (d.type === 'SPACE_TOOL_SAVED' && Number.isSafeInteger(d.request) && pending.has(d.request)) {
      const p = pending.get(d.request); pending.delete(d.request); nativeClear(p.timeout); inflight = false;
      if (typeof d.error === 'string') p.batch.forEach(w => w.reject(new Error(d.error)));
      else p.batch.forEach(w => w.resolve());
      if (dirty) flush();
    } else if (d.type === 'SPACE_TOOL_SNAPSHOT' && typeof d.request === 'string') {
      try { send('SPACE_TOOL_RESULT', { request: d.request, result: clone(result) }); } catch (e) { fail(e); }
    } else if (d.type === 'SPACE_TOOL_CLOSE' && typeof d.request === 'string') {
      pause(); api.saveState(data).then(() => send('SPACE_TOOL_CLOSED', { request:d.request }), fail);
    } else if (d.type === 'SPACE_TOOL_PAUSE') pause();
  });
  window.addEventListener('error', e => fail(e.error || e.message));
  window.addEventListener('unhandledrejection', e => fail(e.reason));
  window.addEventListener('DOMContentLoaded', () => {
    if (initial?.forms) fields().forEach((el, i) => {
      const value = initial.forms[fieldKey(el, i)];
      if (value === undefined) return;
      if (['checkbox', 'radio'].includes(el.type)) el.checked = value === true;
      else if (typeof value === 'string') el.value = value;
    });
    document.addEventListener('input', queueSave);
    document.addEventListener('change', queueSave);
    pause(); send('SPACE_TOOL_READY');
  }, { once: true });
}

export function toolBootstrap(state, instance) {
  return `(${installToolSdk.toString()})(${JSON.stringify(state).replaceAll('<', '\\u003c')},${JSON.stringify(instance)});`;
}

export function buildToolDocument(html, state, instance) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Model meta/base cannot alter the inherited boundary or the trusted bootstrap.
  doc.querySelectorAll('meta[http-equiv],base,script[src],link').forEach(el => el.remove());
  const policy = doc.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
  policy.content = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const bootstrap = doc.createElement('script'); bootstrap.textContent = toolBootstrap(state, instance);
  doc.head.prepend(policy, bootstrap);
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}
