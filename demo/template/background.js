const ALLOWED_ORIGINS = __ORIGINS__;
chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    if (
      sender.id ||
      !sender.url ||
      !ALLOWED_ORIGINS.includes(new URL(sender.url).origin)
    )
      return false;
    if (!message || message.scope !== "space-store/v1") return false;
    if (message.type === "PING") {
      sendResponse({
        id: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
      });
    } else if (
      message.type === "RELOAD" &&
      typeof message.version === "string" &&
      /^\d+\.\d+\.\d+$/.test(message.version)
    ) {
      sendResponse({ accepted: true });
      setTimeout(() => chrome.runtime.reload(), 100);
    }
    return false;
  },
);
