// Only the configured store origin can query identity or request a reload.
// This bridge never exposes settings, API keys, page data, or chat history.
const STORE_ORIGIN = __SPACE_STORE_ORIGIN__;
chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (sender.id || !sender.url) return false;
  try {
    if (new URL(sender.url).origin !== STORE_ORIGIN) return false;
  } catch { return false; }
  if (message?.scope !== 'space-store/v1') return false;
  if (message.type === 'PING') {
    respond({ id: chrome.runtime.id, version: chrome.runtime.getManifest().version });
  } else if (message.type === 'RELOAD' && typeof message.version === 'string' && /^\d+\.\d+\.\d+$/.test(message.version)) {
    respond({ accepted: true });
    setTimeout(() => chrome.runtime.reload(), 100);
  }
  return false;
});
