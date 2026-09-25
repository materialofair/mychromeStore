import './update.css';
import { install, restore, permission, compareVersion, type Backup, type Catalog, type Directory } from './core';
import { scopedStorage } from './storage';
import { ping, reloadAndVerify } from './bridge';
import { validateCatalog, inspectIdentity, validateBackupIdentity } from './update-identity';
import { zipSync } from 'fflate';

const root = document.querySelector<HTMLDivElement>('#update-app')!;
const id = new URL(location.href).searchParams.get('id') ?? '';
const validId = /^[a-p]{32}$/.test(id);
const storage = validId ? scopedStorage(id) : null;
const picker = (window as unknown as {showDirectoryPicker?: (options:{mode:'readwrite';id:string})=>Promise<Directory>}).showDirectoryPicker;
const supported = !!picker && isSecureContext && !!navigator.locks;
let catalog: Catalog | null = null;
let directory: Directory | undefined;
let backup: Backup | undefined;
let diskVersion: string | null = null;
let runtimeVersion: string | null = null;
let busy = false;
let message = validId ? '正在读取扩展目录和本地备份…' : '扩展 ID 无效，请从发布中心选择扩展。';
let error = !validId;
let progress: number | null = null;
let storageFailed = false;
let catalogAvailable = false;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
const disabled = (condition: boolean) => condition ? 'disabled' : '';
const version = (value: string | null | undefined) => value ? `v${esc(value)}` : '未检测到';

async function boundedJSON(path: string): Promise<unknown> {
  const response = await fetch(path,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(120000)});
  if (!response.ok || !response.body) throw new Error(`无法获取已批准版本（${response.status}）；该版本可能已下架，请刷新后重试。`);
  const max = 96 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > max) { await response.body.cancel(); throw new Error('版本数据超过 96 MiB，已停止下载。'); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const {value,done} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new Error('版本数据超过 96 MiB，已停止下载。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset);offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { throw new Error('版本响应格式无效，未修改本地文件。'); }
}
async function freshCatalog() {
  catalogAvailable = false;
  catalog = await validateCatalog(await boundedJSON(`/api/extensions/${id}/catalog`),id,location.origin,catalog);
  catalogAvailable = true;
  return catalog;
}
async function backupState() {
  if (!storage) return;
  backup = await storage.journal.get();
  storageFailed = false;
}
async function versions() {
  runtimeVersion = await ping(id);
  diskVersion = directory && await directory.queryPermission({mode:'readwrite'}) === 'granted'
    ? await inspectIdentity(directory,id,catalog) : null;
}
async function verifyRunning(target: string) {
  message = '文件已写入，正在确认扩展运行版本…'; progress = 100; render();
  const ok = await reloadAndVerify(id,target);
  runtimeVersion = await ping(id);
  message = ok ? `文件与运行版本均已确认：v${target}。` : `文件已更新至 v${target}，尚未确认浏览器运行版本。请在 edge://extensions 手动重新加载，并确认绑定的是实际加载目录。`;
}
async function run(operation: () => Promise<void>) {
  if (busy) return;
  busy = true; error = false; progress = null; render();
  try { await operation(); }
  catch (reason) {
    error = true;
    message = reason instanceof Error ? reason.name === 'AbortError' ? '已取消操作。' : reason.message : '操作未完成，请重试。';
  } finally {
    try { await backupState(); }
    catch { storageFailed = true; error = true; message += ' 本地备份存储不可用，已停止更新。'; }
    busy = false; render();
  }
}
async function bindDirectory() {
  if (!storage || !supported || !catalogAvailable) throw new Error('请先使用桌面 Edge 加载有效的商店目录。');
  if (backup?.status === 'pending') throw new Error('请先恢复未完成更新。');
  const selected = await picker!.call(window,{mode:'readwrite',id:`space-${id.slice(0,20)}`});
  await permission(selected);
  await storage.exclusive(async()=> {
    if ((await storage.journal.get())?.status === 'pending') throw new Error('请先恢复未完成更新。');
    const current = await freshCatalog();
    diskVersion = await inspectIdentity(selected,id,current);
    await storage.saveDirectory(selected); directory = selected;
  });
  await versions();
  message = '目录已连接。请确认这是浏览器实际加载的原目录；页面无法识别另一份同扩展副本。';
}
async function update() {
  if (!directory || !storage || storageFailed) throw new Error('请先连接扩展目录，并确认备份存储可用。');
  await permission(directory);
  await storage.exclusive(async()=> {
    if ((await storage.journal.get())?.status === 'pending') throw new Error('请先恢复未完成更新。');
    message = '正在刷新已批准版本并校验本地身份…'; render();
    const current = await freshCatalog();
    diskVersion = await inspectIdentity(directory!,id,current);
    if (diskVersion === current.latestVersion) { await verifyRunning(diskVersion);return; }
    if (compareVersion(current.latestVersion,diskVersion) <= 0) throw new Error('商店当前版本不高于本地版本，不会自动降级。');
    if (!current.versions.includes(diskVersion)) throw new Error('本地版本已下架或不在已批准列表中，无法安全取得原版校验数据。请联系发布者；本地备份仍可恢复。');
    message = '正在下载并校验原版本和新版本，尚未写入本地文件…'; render();
    const [oldRelease,newRelease] = await Promise.all([
      boundedJSON(`/api/extensions/${id}/releases/${diskVersion}.json`),
      boundedJSON(`/api/extensions/${id}/releases/${current.latestVersion}.json`),
    ]);
    // Refresh again after download so a newly withdrawn release is not installed.
    const approved = await freshCatalog();
    if (!approved.versions.includes(diskVersion) || !approved.versions.includes(current.latestVersion) || approved.latestVersion !== current.latestVersion)
      throw new Error('下载期间发布状态已变化，请重新更新。');
    message = '正在保存备份并更新目录，请保持页面打开…'; render();
    await install(directory!,oldRelease,newRelease,approved,storage.journal,value=>{progress=value;render();});
    diskVersion = await inspectIdentity(directory!,id,approved);
    await verifyRunning(diskVersion);
  });
}
async function restoreBackup() {
  if (!storage) return;
  const saved = await storage.journal.get();
  if (!saved || saved.status === 'restored') throw new Error('没有可恢复的备份。');
  await permission(saved.directory);
  await storage.exclusive(async()=> {
    const latest = await storage.journal.get();
    if (!latest || latest.status === 'restored') throw new Error('备份已由另一页面恢复，请刷新。');
    await validateBackupIdentity(latest,id);
    message = '备份与原目录身份已确认，正在恢复…';render();
    const restored = await restore(storage.journal);
    directory = restored.directory;
    await storage.saveDirectory(directory);
    diskVersion = await inspectIdentity(directory,id);
    await verifyRunning(diskVersion);
    message = runtimeVersion === diskVersion ? `已恢复本地备份，确认运行 v${diskVersion}。` : `已恢复本地文件 v${diskVersion}。请在 edge://extensions 手动重新加载。`;
  });
}
async function downloadBackup() {
  const saved = await storage?.journal.get();
  if (!saved) throw new Error('暂无备份可下载。');
  const files:Record<string,Uint8Array> = Object.create(null);
  for (const [path,bytes] of Object.entries(saved.before)) if (bytes) files[path] = bytes;
  const url = URL.createObjectURL(new Blob([new Uint8Array(zipSync(files))],{type:'application/zip'}));
  const anchor = document.createElement('a'); anchor.href=url;anchor.download=`${id}-backup-${saved.from}.zip`;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  message = '原版本备份已准备下载，请保存到扩展目录之外。';
}
function render() {
  const recovery = backup?.status === 'pending';
  const blocked = busy || !supported || storageFailed || !validId;
  const latestRunning = diskVersion === catalog?.latestVersion && runtimeVersion === diskVersion;
  root.innerHTML = `<div class="publish-shell"><header class="publish-header"><div class="publish-header-brand"><a class="brand" href="/publish.html"><span class="brand-mark" aria-hidden="true">◇</span><span class="brand-text">SPACE</span></a><span class="brand-caption">本地扩展更新</span></div><a class="quiet-link" href="/publish.html">返回扩展目录 ↗</a></header><main><div class="publish-heading"><div><p class="eyebrow">KEEP YOUR TOOLS UP TO DATE</p><h1>${esc(catalog?.name ?? '连接你的本地扩展')}</h1><p>连接原目录，校验、备份、更新。每一步都由你决定。</p></div><span class="publisher-label">仅更新已批准版本</span></div>
    ${!supported ? '<div class="update-warning">请在新版桌面 Edge 的 HTTPS 或 localhost 页面使用本地目录更新。下载 ZIP 后仍可手动加载。</div>' : ''}
    ${recovery ? '<div class="update-warning" role="alert">上次更新尚未完成。请先恢复备份，在恢复前不要重新加载扩展或更换目录。</div>' : ''}
    <div class="publish-layout"><section class="publish-card"><div class="publish-section"><div class="publish-section-title"><span>01</span><h2>版本与目录</h2></div><p class="update-identity">扩展 ID：${esc(id)}</p><dl class="update-versions"><div><dt>商店最新版本</dt><dd>${catalogAvailable ? version(catalog?.latestVersion) : '暂不可用'}</dd></div><div><dt>本地文件版本</dt><dd data-testid="disk-version">${version(diskVersion)}</dd></div><div><dt>浏览器运行版本</dt><dd data-testid="runtime-version">${version(runtimeVersion)}</dd></div></dl><div class="update-folder">${directory ? `已连接：${esc(directory.name)}` : '尚未连接目录，请选择已在浏览器加载的那个文件夹。'}</div><div class="update-actions"><button class="button secondary" id="bind-directory" data-testid="bind" ${disabled(blocked || !!recovery || !catalogAvailable)}>${directory ? '更换目录' : '连接本地目录'}</button><button class="button" id="update-extension" data-testid="update" ${disabled(blocked || !!recovery || !directory || !catalogAvailable || latestRunning)}>${busy ? '正在处理…' : latestRunning ? '已确认运行最新版' : diskVersion === catalog?.latestVersion ? '重新加载扩展' : '更新至最新版本'}</button><button class="text-button" id="refresh-update" ${disabled(busy || !validId)}>刷新版本</button></div><p class="field-note">目录版本与运行版本分别核验。扩展支持 SPACE 通信协议时可尝试自动重载，否则需要手动重新加载。</p><div class="publish-message ${error ? 'error' : ''}" role="${error ? 'alert' : 'status'}" aria-live="polite">${esc(message)}</div>${busy && progress !== null ? `<progress class="update-progress" max="100" value="${Math.max(0,Math.min(100,progress))}" aria-label="更新进度"></progress>` : ''}<button class="text-button" id="copy-extension-page">复制 edge://extensions</button>
    ${backup ? `<section class="update-backup"><h3>本地恢复点 · v${esc(backup.from)}</h3><p>${backup.status === 'restored' ? '此备份已恢复。' : '备份保存在此浏览器中，恢复前会检查原目录身份和文件变化。'}即使版本已下架，身份匹配的本地备份仍可恢复。</p><div class="update-actions"><button class="button secondary small" id="restore-backup" data-testid="restore" ${disabled(blocked || backup.status === 'restored')}>恢复更新前的文件</button><button class="text-button" id="download-backup" ${disabled(busy)}>下载备份 ZIP</button></div></section>` : ''}</div></section>
    <aside class="publish-aside"><section class="publish-current"><h2>首次使用，手动安装一次</h2><ol class="update-instructions"><li>下载已发布 ZIP，解压到专用文件夹。</li><li>打开 edge://extensions，开启开发者模式，选择「加载解压缩的扩展」。</li><li>回到这里，连接同一目录。下次发布新版后点击更新。</li></ol>${catalogAvailable && catalog ? `<a class="button secondary small" href="/api/extensions/${id}/releases/${encodeURIComponent(catalog.latestVersion)}.zip" download>下载 v${esc(catalog.latestVersion)} ZIP ↓</a>` : ''}</section><section class="publish-help"><p class="eyebrow">YOUR FILES, YOUR CONTROL</p><h2>更新发生在<br>你授权的目录里。</h2><ol><li>先校验发布身份和文件，再写入。</li><li>每个扩展独立保存目录与备份。</li><li>文件被手动修改时停止覆盖。</li></ol><p>页面关闭后不会自动更新。请保留浏览器数据和原扩展目录，以便恢复。</p></section></aside></div></main><footer class="publish-footer"><span>SPACE / 保持新鲜，也保留退路。</span><span>用户授权 · 文件校验 · 本地备份</span></footer></div>`;
  root.querySelector('#bind-directory')?.addEventListener('click',()=>void run(bindDirectory));
  root.querySelector('#update-extension')?.addEventListener('click',()=>void run(update));
  root.querySelector('#restore-backup')?.addEventListener('click',()=>void run(restoreBackup));
  root.querySelector('#download-backup')?.addEventListener('click',()=>void run(downloadBackup));
  root.querySelector('#refresh-update')?.addEventListener('click',()=>void run(async()=>{await freshCatalog();await versions();message='已刷新商店、本地文件与浏览器运行版本。';}));
  root.querySelector('#copy-extension-page')?.addEventListener('click',async event=>{const button=event.currentTarget as HTMLButtonElement;try {await navigator.clipboard.writeText('edge://extensions');button.textContent='已复制管理页地址';}catch{button.textContent='请在地址栏手动输入 edge://extensions';}});
}
render();
if (storage) void run(async()=> {
  // Load the local journal first so server outages or withdrawn releases never hide recovery.
  await backupState(); directory = await storage.loadDirectory();
  if (directory && await directory.queryPermission({mode:'readwrite'}) === 'granted') diskVersion = await inspectIdentity(directory,id);
  await freshCatalog(); await versions();
  message = backup?.status === 'pending' ? '检测到未完成更新，请先恢复本地备份。' : '首次安装后，连接浏览器实际加载的扩展目录即可更新。';
});
