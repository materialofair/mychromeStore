import { createToolStateStore, isTrustedToolSender, ToolStateError } from './tool-state.js';

import { withHistoryLock } from '../storage.js';

const store = createToolStateStore(chrome.storage.local, { withHistoryLock });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'SPACE_TOOL_STATE') return;
  if (!isTrustedToolSender(sender, chrome.runtime)) {
    respond({ ok: false, error: '工具状态访问被拒绝。' });
    return;
  }
  store.handle(message).then(data => respond({ ok: true, data }), error => {
    respond({ ok: false, error: error instanceof ToolStateError ? error.message : '工具状态保存失败，请重试。' });
  });
  return true;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.history || changes.savedSessions)) {
    // Deletion/clear must retain state while any saved session still owns it.
    store.gc().catch(() => {});
  }
});
