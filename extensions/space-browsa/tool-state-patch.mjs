import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
function once(text, anchor, replacement) {
  if (text.split(anchor).length !== 2) throw new Error(`Tool state patch anchor mismatch: ${anchor}`);
  return text.replace(anchor, replacement);
}
export async function applyToolStatePatch(work) {
  const storagePath = join(work, 'lib/storage.js');
  let storage = await readFile(storagePath, 'utf8');
  storage = once(storage, 'export async function appendToHistory(message) {', "export async function appendToHistory(message) {\n  if (message?.role === 'assistant') message.spaceToolMessageId ||= crypto.randomUUID();");
  storage = once(storage, 'function withHistoryLock(fn) {', 'export function withHistoryLock(fn) {');
  // Archive writes use the same background queue as live history and migration.
  // Wrapper bodies never call another locked helper, avoiding nested-lock waits.
  const sessionMutators = {
    setActiveSessionId: 'id', saveCurrentSession: 'name', appendToSessionHistory: 'id, entry',
    updateSessionHistory: 'id', pinSession: 'id, pinned', loadSession: 'id',
    deleteSession: 'id', renameSession: 'id, newName', clearAllSessions: ''
  };
  for (const [name, args] of Object.entries(sessionMutators)) {
    storage = once(storage, `export async function ${name}(${args}) {`, `export function ${name}(${args}) {\n  return withHistoryLock(() => _spaceUnlocked_${name}(${args}));\n}\nasync function _spaceUnlocked_${name}(${args}) {`);
  }
  // IDs are assigned before saving/loading archives, so restoring an old session
  // does not rely on text matching after its live history has already been copied.
  storage = once(storage, 'const MAX_SESSIONS = 50;', `const MAX_SESSIONS = 50;
function spaceStampToolMessageIds(history) {
  const seen = new Set();
  for (const entry of history) {
    if (entry?.role !== 'assistant') continue;
    if (!entry.spaceToolMessageId || seen.has(entry.spaceToolMessageId)) entry.spaceToolMessageId = crypto.randomUUID();
    seen.add(entry.spaceToolMessageId);
  }
  return history;
}`);
  storage = once(storage, 'async function _spaceUnlocked_saveCurrentSession(name) {\n  const history = await getHistory();', 'async function _spaceUnlocked_saveCurrentSession(name) {\n  const history = spaceStampToolMessageIds(await getHistory());\n  await setHistory(history);');
  storage = once(storage, "async function _spaceUnlocked_appendToSessionHistory(id, entry) {", "async function _spaceUnlocked_appendToSessionHistory(id, entry) {\n  if (entry?.role === 'assistant') entry.spaceToolMessageId ||= crypto.randomUUID();");
  storage = once(storage, 'async function _spaceUnlocked_updateSessionHistory(id) {\n  if (!id) return null;\n  const history = await getHistory();', 'async function _spaceUnlocked_updateSessionHistory(id) {\n  if (!id) return null;\n  const history = spaceStampToolMessageIds(await getHistory());\n  await setHistory(history);');
  storage = once(storage, "  if (!session) return -1;\n  await set('history', session.history || []);", "  if (!session) return -1;\n  session.history = spaceStampToolMessageIds(session.history || []);\n  await chrome.storage.local.set({ savedSessions });\n  await set('history', session.history);");
  const handlerPath = join(work, 'lib/handlers/chat-handler.js');
  let handler = await readFile(handlerPath, 'utf8');
  handler = once(handler, 'export async function persistTurnEntry(tabId, entry) {', "export async function persistTurnEntry(tabId, entry) {\n  if (entry?.role === 'assistant') entry.spaceToolMessageId ||= crypto.randomUUID();");
  handler = once(handler, '    if (saved) return;', '    if (saved) return entry;');
  handler = once(handler, '  await storage.appendToHistory(entry);\n}', '  await storage.appendToHistory(entry);\n  return entry;\n}');
  handler = once(handler, "  await persistTurnEntry(tabId, { role: 'assistant', content: fullReply, providerLabel, providerKey, ...(replyTruncated ? { outputTruncated: true } : {}), ...(videoSrc ? { videoSrc } : {}) });", "  const completedEntry = await persistTurnEntry(tabId, { role: 'assistant', content: fullReply, providerLabel, providerKey, ...(replyTruncated ? { outputTruncated: true } : {}), ...(videoSrc ? { videoSrc } : {}) });");
  handler = once(handler, "pushChunk(tabId, { type: 'DONE', full: fullReply,", "pushChunk(tabId, { type: 'DONE', spaceToolMessageId: completedEntry.spaceToolMessageId, full: fullReply,");
  const backgroundPath = join(work, 'background.js');
  const background = await readFile(backgroundPath, 'utf8');
  if (background.includes("import './lib/space-ai-ui/tool-state-background.js';")) throw new Error('Tool state patch anchor already applied');
  await mkdir(join(work, 'lib/space-ai-ui'), { recursive: true });
  await writeFile(join(work, 'lib/space-ai-ui/tool-state.js'), (await readFile(new URL('./ai-ui/tool-state.mjs', import.meta.url), 'utf8')).replace("from './protocol.mjs'", "from './protocol.js'"));
  await copyFile(new URL('./ai-ui/tool-state-background.js', import.meta.url), join(work, 'lib/space-ai-ui/tool-state-background.js'));
  await writeFile(storagePath, storage);
  await writeFile(handlerPath, handler);
  await writeFile(backgroundPath, "import './lib/space-ai-ui/tool-state-background.js';\n" + background);
}
