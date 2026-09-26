import { readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const sourceDirectory = fileURLToPath(
  new URL("./attachments/", import.meta.url),
);
function replaceOnce(source, anchor, replacement, label) {
  if (source.split(anchor).length !== 2)
    throw new Error(`Attachment patch anchor mismatch: ${label}`);
  return source.replace(anchor, replacement);
}
export async function applyAttachmentsPatch(work) {
  const path = join(work, "sidepanel.js");
  let source = await readFile(path, "utf8");
  const patch = (anchor, replacement, label) => {
    source = replaceOnce(source, anchor, replacement, label);
  };
  patch(
    "import { PAGE_CONTEXT_PREFIX } from './lib/constants.js';",
    "import { PAGE_CONTEXT_PREFIX } from './lib/constants.js';\nimport { mountDocumentAttachments, documentPrompt } from './lib/sidepanel/space-attachments.js';",
    "import",
  );
  patch(
    "const images = [];             // { dataUrl, name } — attached for this turn",
    `const images = [];             // { dataUrl, name } — attached for this turn
const spaceDocuments = mountDocumentAttachments({ anchor: imagePreviewsEl, picker: imagePicker, notify: message => showToast(message, 'error') });
document.addEventListener('space-context-reset', () => spaceDocuments.clear());`,
    "state",
  );
  patch(
    "    currentTabId = tabId;",
    "    if (currentTabId !== tabId) spaceDocuments.clear();\n    currentTabId = tabId;",
    "tab-change",
  );
  patch(
    "async function newSession() {",
    "async function newSession() {\n  spaceDocuments.clear();",
    "new-session",
  );
  patch(
    "  if (!ok) return;\n  cancelStream({ salvage: false });",
    "  if (!ok) return;\n  spaceDocuments.clear();\n  cancelStream({ salvage: false });",
    "clear-confirmed",
  );
  patch(
    "clearPendingImages: () => { images.length = 0; refreshImageStrip(); }",
    "clearPendingImages: () => { spaceDocuments.clear(); images.length = 0; refreshImageStrip(); }",
    "session-clear",
  );
  patch(
    `async function handleDroppedFiles(fileList) {
  const maxSize = 20 * 1024 * 1024;`,
    `async function handleDroppedFiles(fileList) {
  const dropContext = spaceDocuments.contextId;
  const maxSize = 20 * 1024 * 1024;`,
    "drop-context",
  );
  patch(
    "    if (!f.type.startsWith('image/')) continue;",
    "    if (dropContext !== spaceDocuments.contextId) break;\n    if (!f.type.startsWith('image/')) { void spaceDocuments.add(f); continue; }",
    "drop-documents",
  );
  patch(
    "    const dataUrl = await fileToDataUrl(f);",
    "    const dataUrl = await fileToDataUrl(f);\n    if (dropContext !== spaceDocuments.contextId) break;",
    "image-context",
  );
  patch(
    "async function onSend() {",
    `async function onSend(spaceSendOptions = {}) {
  const spaceReadingGuard = typeof spaceSendOptions?.spaceReadingGuard === 'function' ? spaceSendOptions.spaceReadingGuard : null;
  if (spaceReadingGuard && !spaceReadingGuard()) return false;`,
    "send-guard",
  );
  patch(
    "  const rawText = inputEl.value.trim();",
    `  let attachmentSnapshot;
  try { attachmentSnapshot = spaceDocuments.snapshot(); }
  catch (error) { showToast(error.message, 'error'); return; }
  if (attachmentSnapshot.documents.length && activeController && !activeController.cancelled) {
    showToast('回复生成中，请等待完成后再发送文档', 'error'); return;
  }
  const attachmentTab = currentTabId;
  const attachmentDraft = inputEl.value;
  const rawText = inputEl.value.trim();`,
    "send-snapshot",
  );
  patch(
    "    if (!images.length) return;",
    "    if (!images.length && !attachmentSnapshot.documents.length) return;",
    "document-only",
  );
  patch(
    "  const text = slashExpanded || rawText;",
    "  const text = documentPrompt(slashExpanded || rawText, attachmentSnapshot);",
    "document-prompt",
  );
  patch(
    "  // User bubble — show the original slash command, not the expanded prompt",
    `  if (activeController && !activeController.cancelled) return false;
  if (spaceReadingGuard && !spaceReadingGuard()) return false;
  if (inputEl.value !== attachmentDraft || (attachmentSnapshot.documents.length && (!spaceDocuments.isCurrent(attachmentSnapshot) || currentTabId !== attachmentTab))) {
    showToast('草稿、附件或会话已改变，本次未发送；请重新确认', 'error'); return false;
  }
  // User bubble — show the original slash command, not the expanded prompt`,
    "pre-bubble-context",
  );
  patch(
    "  lastSentRaw = rawText;",
    "  lastSentRaw = rawText || (attachmentSnapshot.documents.length ? '请分析所附文档。' : '');",
    "retry-documents",
  );
  patch(
    "  const userBubble = appendUser(rawText || (pendingImageUrls ? '(image)' : '(page only)'), pendingImageUrls);",
    `  const documentNames = attachmentSnapshot.documents.map(f => '[文档: ' + f.name + ']').join('\\n');
  const userBubble = appendUser([rawText, documentNames].filter(Boolean).join('\\n') || (pendingImageUrls ? '(image)' : '(page only)'), pendingImageUrls);`,
    "document-bubble",
  );
  patch(
    "    const sessionForTurn = (await storage.getActiveSessionId()) || undefined;",
    `    const sessionForTurn = (await storage.getActiveSessionId()) || undefined;
    if (spaceReadingGuard && !spaceReadingGuard({ committed: true })) throw new Error('页面或会话已改变，本次总结没有发送');
    if (attachmentSnapshot.documents.length && (!spaceDocuments.isCurrent(attachmentSnapshot) || currentTabId !== attachmentTab)) {
      throw new Error('附件已移除或会话已改变，文档没有发送；请重新确认');
    }`,
    "pre-request-context",
  );
  patch(
    "    const res = await sendMessage({\n      type: 'CHAT',",
    "    spaceDocuments.markSending(attachmentSnapshot);\n    const res = await sendMessage({\n      type: 'CHAT',",
    "mark-sent",
  );
  patch(
    "  } finally {\n    setStreamingUI(false);\n  }\n}\n\n// Re-attach a streaming port",
    "  } finally {\n    spaceDocuments.finishSending(attachmentSnapshot);\n    setStreamingUI(false);\n  }\n}\n\n// Re-attach a streaming port",
    "release-sent-status",
  );
  patch(
    "      sessionId: sessionForTurn\n    });\n    if (!res.ok)",
    "      sessionId: sessionForTurn\n    });\n    if (res.ok) spaceDocuments.consume(attachmentSnapshot);\n    if (!res.ok)",
    "consume-on-success",
  );
  let html = await readFile(join(work, "sidepanel.html"), "utf8");
  html = replaceOnce(
    html,
    'accept="image/*" multiple',
    'accept="image/*,.txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf" multiple',
    "file-picker",
  );
  let sessions = await readFile(
    join(work, "lib/sidepanel/sessions-ui.js"),
    "utf8",
  );
  sessions = replaceOnce(
    sessions,
    "export async function loadSession(id, name) {",
    "export async function loadSession(id, name) {\n  document.dispatchEvent(new Event('space-context-reset'));",
    "load-session",
  );
  const css = await readFile(join(work, "sidepanel.css"), "utf8");
  if (css.includes("/* SPACE local document attachments */"))
    throw new Error("Attachment styles already applied");
  // Validate all anchors before writing any patched upstream file.
  await writeFile(path, source);
  await writeFile(join(work, "sidepanel.html"), html);
  await writeFile(join(work, "lib/sidepanel/sessions-ui.js"), sessions);
  await writeFile(
    join(work, "sidepanel.css"),
    css +
      `\n/* SPACE local document attachments */\n#space-add-files { align-self: start; margin: 4px 0; padding: 5px 12px; font-size: 12px; line-height: 1.5; cursor: pointer; border: 1px solid var(--border); border-radius: var(--radius-sm, 8px); color: var(--fg); background: var(--bg); }\n#space-document-attachments { display: grid; gap: 6px; margin: 8px 0; font-size: 12px; }\n#space-document-attachments:empty { display: none; }\n.space-document-attachment { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 8px; border: 1px solid currentColor; border-radius: 8px; padding: 8px 10px; }\n.space-document-attachment strong { overflow-wrap: anywhere; }\n.space-document-attachment span { grid-column: 1; opacity: .8; }\n.space-document-attachment button { grid-column: 2; grid-row: 1 / 3; align-self: center; }\n.space-document-attachment[data-status="error"] { color: #c74632; }\n#space-document-attachments small { opacity: .75; line-height: 1.5; }\n`,
  );
  await copyFile(
    join(sourceDirectory, "space-attachments.js"),
    join(work, "lib/sidepanel/space-attachments.js"),
  );
}
