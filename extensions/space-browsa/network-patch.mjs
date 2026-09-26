import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error(`Network patch anchor mismatch: ${anchor}`);
  return source.replace(anchor, replacement);
}

export async function applyNetworkPatch(work) {
  const source = fileURLToPath(new URL('./network/', import.meta.url));
  const manifest = JSON.parse(await readFile(join(work, 'manifest.json'), 'utf8'));
  if (manifest.permissions.includes('debugger')) throw new Error('Network patch: debugger already present');
  manifest.permissions.push('debugger');
  let background = await readFile(join(work, 'background.js'), 'utf8');
  background = replaceOnce(background,
    'chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {',
    "chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {\n  if (msg?.type === 'SPACE_NETWORK') return; // Handled by the isolated recorder.");
  background = "import { installNetworkRecorder } from './lib/space-network/recorder.js';\ninstallNetworkRecorder(chrome);\n" + background;
  let panel = await readFile(join(work, 'sidepanel.js'), 'utf8');
  panel = replaceOnce(panel,
    "document.addEventListener('space-context-reset', () => spaceDocuments.clear());",
    "document.addEventListener('space-context-reset', () => spaceDocuments.clear());\nmountNetworkPanel({ getTabId: () => currentTabId, attachDocument: file => spaceDocuments.add(file) });");
  panel = "import { mountNetworkPanel } from './lib/space-network/panel.js';\n" + panel;
  const css = await readFile(join(work, 'sidepanel.css'), 'utf8');
  if (css.includes('/* SPACE network log:')) throw new Error('Network patch already applied');
  // Validate every anchor before touching the exported upstream source.
  await mkdir(join(work, 'lib/space-network'), { recursive: true });
  for (const file of ['recorder.js', 'markdown.js', 'panel.js']) await copyFile(join(source, file), join(work, 'lib/space-network', file));
  await writeFile(join(work, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(work, 'background.js'), background);
  await writeFile(join(work, 'sidepanel.js'), panel);
  await writeFile(join(work, 'sidepanel.css'), css + '\n' + await readFile(join(source, 'panel.css'), 'utf8'));
}
