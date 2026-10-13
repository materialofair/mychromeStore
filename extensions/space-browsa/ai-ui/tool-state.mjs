import { parseUi, isUiBlocked } from './protocol.mjs';

export const TOOL_STATE_KEY = 'spaceToolStateV1';
const STORAGE_KEYS = ['history', 'savedSessions', 'activeSessionId', TOOL_STATE_KEY];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DANGEROUS = new Set(['__proto__', 'prototype', 'constructor']);
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const plain = value => value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
export class ToolStateError extends Error {}
function fail(message) { throw new ToolStateError(message); }

export function isTrustedToolSender(sender, runtime) {
  return sender?.id === runtime.id && sender?.url === runtime.getURL('sidepanel.html');
}

export function validateToolSnapshot(snapshot) {
  let nodes = 0;
  function json(value, depth = 0) {
    if (++nodes > 10000 || depth > 16) fail('工具状态结构超出限制。');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string') { if (value.length > 65536) fail('工具状态文字超出限制。'); return; }
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail('工具状态含无效数值。'); return; }
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 5000 || Object.keys(value).length !== value.length || Reflect.ownKeys(value).length !== value.length + 1) fail('工具状态数组无效。');
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor)) fail('工具状态数组无效。');
        json(descriptor.value, depth + 1);
      }
      return;
    }
    if (!plain(value)) fail('工具状态必须为 JSON 数据。');
    const keys = Object.keys(value);
    if (keys.length > 5000 || Reflect.ownKeys(value).length !== keys.length) fail('工具状态字段无效。');
    for (const key of keys) {
      if (DANGEROUS.has(key) || key.length > 256) fail('工具状态字段无效。');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) fail('工具状态字段无效。');
      json(descriptor.value, depth + 1);
    }
  }
  if (!plain(snapshot) || Object.keys(snapshot).sort().join(',') !== 'data,forms,result' || !plain(snapshot.forms)) fail('工具状态格式无效。');
  if (snapshot.result !== null && (!plain(snapshot.result) || Object.keys(snapshot.result).sort().join(',') !== 'data,summary' || typeof snapshot.result.summary !== 'string' || snapshot.result.summary.length > 8192)) fail('工具结果格式无效。');
  json(snapshot);
  if (bytes(snapshot) > 128 * 1024) fail('工具状态超过 128 KiB。');
  return JSON.parse(JSON.stringify(snapshot));
}

async function sha256(source) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Only the privileged background owns this queue and state key. No model settings
// or credentials are read; the storage facade is deliberately restricted above.
export function createToolStateStore(storage, { randomUUID = () => crypto.randomUUID(), hashSource = sha256, maxTotalBytes = 2 * 1024 * 1024, withHistoryLock = fn => fn() } = {}) {
  let chain = Promise.resolve();
  const queue = fn => {
    const locked = () => withHistoryLock(fn);
    const run = chain.then(locked, locked);
    chain = run.catch(() => {});
    return run;
  };
  async function read() {
    const value = await storage.get(STORAGE_KEYS);
    return { history: Array.isArray(value.history) ? value.history : [], savedSessions: Array.isArray(value.savedSessions) ? value.savedSessions : [], activeSessionId: value.activeSessionId || '', states: plain(value[TOOL_STATE_KEY]) ? value[TOOL_STATE_KEY] : {} };
  }
  function retainedIds(db) {
    const ids = new Set();
    for (const history of [db.history, ...db.savedSessions.map(s => Array.isArray(s.history) ? s.history : [])]) {
      for (const entry of history) if (entry?.role === 'assistant' && UUID.test(entry.spaceToolMessageId || '')) ids.add(entry.spaceToolMessageId);
    }
    return ids;
  }
  function collect(db) {
    const ids = retainedIds(db);
    const states = {};
    for (const [id, state] of Object.entries(db.states)) if (ids.has(id)) states[id] = state;
    db.states = states;
  }
  async function writeStates(db) {
    if (bytes(db.states) > maxTotalBytes) fail('工具状态总配额已满（2 MiB），请重置不需要的工具或删除旧会话。');
    await storage.set({ [TOOL_STATE_KEY]: db.states });
  }
  function comparable(entry) {
    if (!entry || typeof entry !== 'object') return '';
    const { spaceToolMessageId: ignored, ...rest } = entry;
    return JSON.stringify(rest);
  }
  async function prepare(db) {
    let changed = false;
    // Legacy entries have no identity. Only a uniquely supported contiguous
    // overlap in the active conversation may reuse archived UUIDs. Repeated
    // content with tied alignments fails closed and receives fresh identities.
    const active = db.savedSessions.find(s => s.id === db.activeSessionId);
    if (Array.isArray(active?.history)) {
      const same = (a, b) => comparable(a) === comparable(b) &&
        !(UUID.test(a?.spaceToolMessageId || '') && UUID.test(b?.spaceToolMessageId || '') && a.spaceToolMessageId !== b.spaceToolMessageId);
      const anchors = db.history.flatMap((entry, position) => {
        if (!UUID.test(entry?.spaceToolMessageId || '')) return [];
        const locations = active.history.flatMap((archived, index) => archived?.spaceToolMessageId === entry.spaceToolMessageId ? [index] : []);
        return locations.length === 1 ? [{ position, archivedPosition: locations[0] }] : [];
      });
      const candidates = [];
      for (let start = 0; start < active.history.length; start++) {
        if (anchors.some(anchor => start + anchor.position !== anchor.archivedPosition)) continue;
        let length = 0;
        while (length < db.history.length && start + length < active.history.length && same(db.history[length], active.history[start + length])) length++;
        // A shorter overlap can be the real trimmed suffix plus new messages.
        // Text length cannot discard it; only stable UUID anchors can do that.
        if (length) candidates.push({ start, length });
      }
      if (candidates.length === 1) {
        const { start, length } = candidates[0];
        const archived = active.history.slice(start, start + length);
        for (const [position, entry] of db.history.slice(0, length).entries()) {
          if (entry?.role !== 'assistant') continue;
          const counterpart = archived[position];
          const id = UUID.test(counterpart.spaceToolMessageId || '') ? counterpart.spaceToolMessageId : UUID.test(entry.spaceToolMessageId || '') ? entry.spaceToolMessageId : randomUUID();
          if (entry.spaceToolMessageId !== id || counterpart.spaceToolMessageId !== id) changed = true;
          entry.spaceToolMessageId = id; counterpart.spaceToolMessageId = id;
        }
      }
    }
    for (const history of [db.history, ...db.savedSessions.map(s => Array.isArray(s.history) ? s.history : [])]) {
      const used = new Set();
      for (const entry of history) {
        if (entry?.role !== 'assistant') continue;
        if (!UUID.test(entry.spaceToolMessageId || '') || used.has(entry.spaceToolMessageId)) { entry.spaceToolMessageId = randomUUID(); changed = true; }
        used.add(entry.spaceToolMessageId);
      }
    }
    collect(db);
    if (bytes(db.states) > maxTotalBytes) fail('工具状态总配额已满。');
    await storage.set({ ...(changed ? { history: db.history, savedSessions: db.savedSessions } : {}), [TOOL_STATE_KEY]: db.states });
    return { history: db.history };
  }
  async function resolveMessage(db, request) {
    if (!UUID.test(request.messageId || '')) fail('工具消息不存在。');
    const matches = db.history.filter(m => m?.role === 'assistant' && m.spaceToolMessageId === request.messageId);
    if (matches.length !== 1 || isUiBlocked(matches[0])) fail('工具消息不存在或不可运行。');
    const ui = parseUi(matches[0].content);
    if (ui.state !== 'ready') fail('工具消息不存在或不可运行。');
    if (!/^[0-9a-f]{64}$/.test(request.sourceHash || '') || await hashSource(ui.html) !== request.sourceHash) fail('工具来源已改变，请重新打开。');
  }
  return {
    handle(request) {
      return queue(async () => {
        if (!plain(request)) fail('工具请求格式无效。');
        const db = await read();
        if (request.op === 'PREPARE') return prepare(db);
        if (!['LOAD', 'SAVE', 'RESET'].includes(request.op)) fail('工具操作无效。');
        await resolveMessage(db, request);
        collect(db);
        const previous = db.states[request.messageId];
        if (previous && Object.hasOwn(previous, 'stateSchemaVersion') && previous.stateSchemaVersion !== 1) fail('工具状态版本不受支持，请使用兼容版本。');
        if (previous && previous.sourceHash !== request.sourceHash) fail('工具来源与已保存状态不匹配。');
        if (request.op === 'LOAD') {
          const lease = randomUUID();
          const state = previous?.state == null ? null : validateToolSnapshot(previous.state);
          db.states[request.messageId] = { stateSchemaVersion: 1, sourceHash: request.sourceHash, lease, state };
          await writeStates(db);
          return { lease, state };
        }
        if (!previous || !UUID.test(request.lease || '') || previous.lease !== request.lease) fail('工具操作已过期，请重新打开工具。');
        const state = request.op === 'RESET' ? null : validateToolSnapshot(request.state);
        db.states[request.messageId] = { ...previous, stateSchemaVersion: 1, state };
        await writeStates(db);
        return { state };
      });
    },
    gc() { return queue(async () => { const db = await read(); collect(db); await writeStates(db); }); }
  };
}
