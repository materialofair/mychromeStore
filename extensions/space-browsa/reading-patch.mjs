import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function replaceOnce(source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`SPACE reading patch anchor ${label}: expected 1, got ${count}`);
  return source.replace(anchor, replacement);
}
const oldQuickbar = `  document.querySelectorAll('.qa-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      inputEl.value = btn.dataset.cmd || '';
      inputEl.focus();
      onSend();
    });
  });`;
const newQuickbar = `  // SPACE reading patch: explicit source status and draft-safe quick actions.
  const readingStatus = document.createElement('p');
  readingStatus.id = 'space-reading-status';
  readingStatus.setAttribute('role', 'status');
  readingStatus.setAttribute('aria-live', 'polite');
  readingStatus.hidden = true;
  $('quickbar')?.insertAdjacentElement('afterend', readingStatus);
  let readingSessionEpoch = 0;
  document.addEventListener('space-context-reset', () => { readingSessionEpoch++; });
  clearBtn?.addEventListener('click', () => { readingSessionEpoch++; });
  chrome.tabs.onActivated.addListener(() => { readingSessionEpoch++; });
  chrome.tabs.onUpdated.addListener((tabId, changes) => {
    if (tabId === currentTabId && changes.url) readingSessionEpoch++;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('activeSessionId' in changes || 'history' in changes)) readingSessionEpoch++;
  });
  const runReadingAction = createReadingActions({
    getDraft: () => inputEl.value || '',
    hasAttachments: () => images.length > 0 || !!document.querySelector('[data-space-attachment]'),
    isStreaming: () => !!(activeController && !activeController.cancelled),
    getTabId: () => currentTabId,
    getSessionEpoch: () => readingSessionEpoch,
    getSessionId: () => storage.getActiveSessionId(),
    getTab: (tabId) => chrome.tabs.get(tabId),
    readPage: (tabId) => sendMessage({ type: 'GET_PAGE_CONTEXT', tabId, mode: 'reader' }),
    report: (text, failed) => {
      readingStatus.hidden = false;
      readingStatus.textContent = text;
      readingStatus.dataset.state = failed ? 'error' : 'ready';
      if (failed) showToast(text, 'error');
    },
    sendPrompt: async (prompt, guard) => {
      inputEl.value = prompt;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.focus();
      return await onSend({ spaceReadingGuard: guard });
    },
  });
  document.querySelectorAll('.qa-btn').forEach((btn) => {
    btn.addEventListener('click', () => { void runReadingAction(btn.dataset.cmd || ''); });
  });`;
const oldSelection = `  document.addEventListener('mouseup', (e) => {
    if (!toolbarEnabled || suppressedForPage || confirmOpen) return;
    // Ignore clicks inside our own toolbar / explain popover
    if (e.composedPath().some((el) => el === host || el === popHost)) return;

    // Ignore text inputs / editable areas
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
              t.isContentEditable || t.contentEditable === 'true')) {
      hide();
      return;
    }

    clearTimeout(pendingShow);
    pendingShow = setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      if (!text || text.length < MIN_CHARS || sel.isCollapsed) { hide(); return; }

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) { hide(); return; }

      currentText = text.slice(0, MAX_PREVIEW);
      lastRange = range;
      place(rect);
    }, DEBOUNCE_MS);
  });`;
const newSelection = `  // SPACE reading patch: keyboard and mouse share editable-aware selection checks.
  function spaceEditable(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    return !!(element && (element.isContentEditable || element.closest?.('input, textarea, [role="textbox"]')));
  }
  function spaceScheduleSelection(e) {
    if (!toolbarEnabled || suppressedForPage || confirmOpen) return;
    if (e.composedPath().some((el) => el === host || el === popHost)) return;
    clearTimeout(pendingShow);
    pendingShow = setTimeout(() => {
      const sel = window.getSelection();
      if (spaceEditable(e.target) || spaceEditable(document.activeElement) || spaceEditable(sel?.anchorNode) || spaceEditable(sel?.focusNode)) { hide(); return; }
      const text = sel ? sel.toString().trim() : '';
      if (!text || text.length < MIN_CHARS || sel.isCollapsed || !sel.rangeCount) { hide(); return; }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) { hide(); return; }
      currentText = text.slice(0, MAX_PREVIEW);
      lastRange = range;
      place(rect);
    }, DEBOUNCE_MS);
  }
  document.addEventListener('mouseup', spaceScheduleSelection);
  document.addEventListener('keyup', (e) => {
    if ((e.shiftKey && /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown)$/.test(e.key)) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a')) spaceScheduleSelection(e);
  });`;

export async function applyReadingPatch(work) {
  const sidepanelPath = join(work,'sidepanel.js');
  const toolbarPath = join(work,'lib/content-scripts/selection-toolbar.js');
  const cssPath = join(work,'sidepanel.css');
  let sidepanel = await readFile(sidepanelPath,'utf8');
  let toolbar = await readFile(toolbarPath,'utf8');
  let css = await readFile(cssPath,'utf8');
  sidepanel = replaceOnce(sidepanel,"import { PAGE_CONTEXT_PREFIX } from './lib/constants.js';","import { PAGE_CONTEXT_PREFIX } from './lib/constants.js';\nimport { createReadingActions } from './lib/sidepanel/space-reading.js';\nimport { renderReadingMessage } from './lib/sidepanel/space-reading-display.js';",'sidepanel-import');
  sidepanel = replaceOnce(sidepanel,oldQuickbar,newQuickbar,'quickbar-handlers');
  sidepanel = replaceOnce(sidepanel,"  span.className = 'msg-text';\n  span.textContent = text;\n  el.appendChild(span);\n  addTimestamp(el);\n  addMsgActions(el, () => el.dataset.raw || text);","  span.className = 'msg-text';\n  renderReadingMessage(span, text);\n  el.appendChild(span);\n  addTimestamp(el);\n  addMsgActions(el, () => el.dataset.raw || text);",'append-user-material-display');
  sidepanel = replaceOnce(sidepanel,'async function newSession() {',"async function newSession() {\n  document.dispatchEvent(new Event('space-context-reset'));",'new-session-reset');
  toolbar = replaceOnce(toolbar,oldSelection,newSelection,'selection-mouseup');
  toolbar = replaceOnce(toolbar,"    if (e.key !== 'Escape') return;", "    if (e.key !== 'Escape') return;\n    clearTimeout(pendingShow);",'selection-escape-cancels-pending');
  toolbar = replaceOnce(toolbar,'      .bar.on { display: flex; }','      .bar { box-sizing: border-box; max-width: calc(100vw - 20px); max-height: calc(100vh - 20px); flex-wrap: wrap; overflow: auto; }\n      .bar.on { display: flex; }','toolbar-viewport-css');
  toolbar = replaceOnce(toolbar,"    bar.style.top = top + 'px';","    top = Math.max(margin, Math.min(top, vh - barH - margin));\n    bar.style.top = top + 'px';",'toolbar-vertical-clamp');
  toolbar = replaceOnce(toolbar,"  window.addEventListener('resize', () => {\n    if (explain) placePopover();\n  });","  window.addEventListener('resize', () => {\n    if (bar.classList.contains('on') && lastRange) place(lastRange.getBoundingClientRect());\n    if (explain) placePopover();\n  });",'toolbar-resize');
  const marker = '/* SPACE reading patch */';
  if (css.includes(marker)) throw new Error('SPACE reading patch CSS was already applied');
  css += `\n${marker}\n#space-reading-status { margin: 6px 12px; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; color: var(--muted, #788574); }\n#space-reading-status[data-state="error"] { color: #bd7357; }\n`;
  css += '\n.space-reading-heading, .space-reading-metadata { display: block; white-space: pre-wrap; overflow-wrap: anywhere; }\n.space-reading-metadata { margin-top: 6px; font-size: 12px; opacity: .75; }\n.space-reading-material { margin-top: 9px; font-size: 12px; }\n.space-reading-material summary { cursor: pointer; }\n.space-reading-material pre { max-height: 260px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; margin: 9px 0 0; }\n';
  // Validate every upstream anchor before changing any file.
  await mkdir(join(work,'lib/sidepanel'),{recursive:true});
  const helper = await readFile(new URL('./reading/actions.mjs',import.meta.url),'utf8');
  const displayHelper = await readFile(new URL('./reading/display.mjs',import.meta.url),'utf8');
  await writeFile(join(work,'lib/sidepanel/space-reading.js'),helper);
  await writeFile(join(work,'lib/sidepanel/space-reading-display.js'),displayHelper);
  await writeFile(sidepanelPath,sidepanel);
  await writeFile(toolbarPath,toolbar);
  await writeFile(cssPath,css);
}
