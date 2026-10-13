import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
function once(text, anchor, replacement) {
  if (text.split(anchor).length !== 2) throw new Error(`Tool revision anchor mismatch: ${anchor}`);
  return text.replace(anchor,replacement);
}
export async function applyToolRevisionsPatch(work) {
  const path=join(work,'lib/handlers/chat-handler.js');
  let handler=await readFile(path,'utf8');
  handler=once(handler,'  const history = await storage.getHistory();',`  const history = await storage.getHistory();
  const spaceToolParentId = typeof msg.spaceToolParentId === 'string' && /^[a-f0-9-]{36}$/.test(msg.spaceToolParentId) && history.some(entry => entry.role === 'assistant' && entry.spaceToolMessageId === msg.spaceToolParentId) ? msg.spaceToolParentId : null;`);
  handler=once(handler,"const completedEntry = await persistTurnEntry(tabId, { role: 'assistant', content: fullReply,", "const completedEntry = await persistTurnEntry(tabId, { ...(spaceToolParentId ? {spaceToolParentId} : {}), role: 'assistant', content: fullReply,");
  handler=once(handler,"type: 'DONE', spaceToolMessageId: completedEntry.spaceToolMessageId,", "type: 'DONE', spaceToolMessageId: completedEntry.spaceToolMessageId, spaceToolParentId:completedEntry.spaceToolParentId,");
  await writeFile(path,handler);
}
