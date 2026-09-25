import './publish.css';

type Role = 'viewer' | 'developer' | 'reviewer' | 'admin';
interface User { id: string; username: string; role: Role; disabled?: boolean }
interface Session { user: User | null; csrfToken?: string }
interface Extension { extensionId: string; name: string; latestVersion: string; versions: string[]; description: string }
interface Submission { id: string; extensionId: string; name: string; version: string; description: string; status: string; submitterId: string; submitterName: string; reviewerName?: string; createdAt: string; reviewedAt?: string; reason?: string; permissions: string[] }
interface Detail { submission: Submission; previousPermissions: string[]; files: { path: string; bytes: number; sha256: string }[]; history?: { action: string; actorName: string; createdAt: string; detail: string }[] }
let session: Session = { user: null };
let catalog: Extension[] = [];
let submissions: Submission[] = [];
let users: User[] = [];
let detail: Detail | null = null;
let page: 'catalog' | 'submissions' | 'users' = 'catalog';
let busy = false;
let query = '';
const root = document.querySelector<HTMLDivElement>('#publish-app')!;
const roleNames: Record<Role,string> = { viewer: '浏览者', developer: '开发者', reviewer: '审核员', admin: '管理员' };
const statuses: Record<string,string> = { pending: '待审核', approved: '已发布', rejected: '已驳回', unpublished: '已下架' };
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
const pathId = (value: string) => encodeURIComponent(value);
const canUpload = () => ['developer','admin'].includes(session.user?.role ?? '');
const canReview = () => ['reviewer','admin'].includes(session.user?.role ?? '');
const canSubmit = () => canUpload() || canReview();
const roleOptions = (selected = 'viewer') => Object.entries(roleNames).map(([role,name]) => `<option value="${role}" ${role === selected ? 'selected' : ''}>${name}</option>`).join('');
const fileSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
function notice(message: string, error = false) {
  const target = root.querySelector<HTMLElement>('#portal-message');
  if (target) { target.textContent = message; target.classList.toggle('error',error); target.setAttribute('role', error ? 'alert' : 'status'); }
}
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.method && options.method !== 'GET' && path !== '/api/login') {
    if (!session.csrfToken) throw new Error('登录状态已失效，请重新登录。');
    headers.set('X-CSRF-Token', session.csrfToken);
  }
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin', signal: AbortSignal.timeout(30000) });
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('发布服务未返回有效响应。请使用包含 API 的服务地址打开发布中心。'); }
  if (!response.ok) throw new ApiError((body as {error?:string}).error || `请求失败 (${response.status})`, response.status);
  return body as T;
}
const json = (method: string, body: unknown): RequestInit => ({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function load() {
  catalog = (await api<{extensions:Extension[]}>('/api/catalog')).extensions;
  submissions = canSubmit() ? (await api<{submissions:Submission[]}>('/api/submissions')).submissions : [];
  users = session.user?.role === 'admin' ? (await api<{users:User[]}>('/api/users')).users : [];
}
async function run(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  root.setAttribute('aria-busy','true');
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
  buttons.forEach(button => { button.dataset.wasDisabled = String(button.disabled); button.disabled = true; });
  notice('正在处理，请稍候…');
  try { await action(); }
  catch (error) {
    if (error instanceof ApiError && [401,403].includes(error.status)) {
      try {
        const fresh = await api<Session>('/api/session');
        const changed = fresh.user?.id !== session.user?.id || fresh.user?.role !== session.user?.role;
        session = fresh;
        if (changed) { page = 'catalog'; detail = null; submissions = []; users = []; render(); }
      } catch { session = {user:null}; page = 'catalog'; detail = null; render(); }
    }
    notice(error instanceof Error ? error.message : '操作失败，请重试。', true);
  }
  finally {
    busy = false; root.setAttribute('aria-busy','false');
    buttons.forEach(button => { button.disabled = button.dataset.wasDisabled === 'true'; });
  }
}
function catalogView() {
  const filtered = catalog.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase().trim()));
  return `<div class="portal-section-heading"><h2>已发布扩展 <span>${catalog.length}</span></h2><label class="portal-search"><span class="visually-hidden">搜索已发布扩展</span><input id="catalog-search" type="search" placeholder="搜索名称或描述" value="${esc(query)}"></label></div>
    <div class="portal-info">下载 ZIP 后解压，在 <code>edge://extensions</code> 开启开发者模式并加载目录。已安装的扩展可连接原目录，在更新页面校验并更新本地文件。</div>
    <div class="catalog-grid">${filtered.length ? filtered.map(item => `<article class="portal-extension"><div class="portal-extension-heading"><span class="portal-extension-mark" aria-hidden="true">▧</span><div><h3>${esc(item.name)}</h3><span class="portal-version">v${esc(item.latestVersion)}</span></div></div><p>${esc(item.description || '作者尚未提供描述。')}</p><div class="portal-extension-footer"><span>${item.versions.length} 个已发布版本</span><a class="button secondary small" href="/api/extensions/${pathId(item.extensionId)}/releases/${pathId(item.latestVersion)}.zip" download>下载 ZIP ↓</a><a class="button small" href="/update.html?id=${pathId(item.extensionId)}">更新本地扩展 →</a></div></article>`).join('') : '<div class="portal-empty">暂无匹配的已发布扩展。<p>开发者提交并通过审核后，扩展会出现在这里。</p></div>'}</div>`;
}
function uploadView() {
  if (!canUpload()) return '';
  return `<form id="upload-form" class="publish-card portal-upload"><div class="publish-section"><div class="publish-section-title"><span>01</span><h2>提交一个新版本</h2></div><label class="upload-zone"><span class="upload-symbol" aria-hidden="true">↑</span><strong id="zip-label">上传 ZIP</strong><small class="field-note">最大 4 MB · 根目录包含 Manifest V3、固定 key 与三段版本号</small><input id="zip-file" type="file" name="package" accept=".zip,application/zip" required></label><p class="field-note">同一扩展保留原 key，新版本递增。内置 Focus Notes Demo 的 ID 被保留；请使用独立扩展包。</p></div><div class="publish-section publish-submit-row"><p>提交后进入审核队列。审核通过后，其他人才能在商店下载。</p><button class="button" type="submit">提交审核 →</button></div></form>`;
}
function detailView() {
  if (!detail) return '';
  const item = detail.submission;
  const permissions = Array.isArray(item.permissions) ? item.permissions : [];
  const previous = Array.isArray(detail.previousPermissions) ? detail.previousPermissions : [];
  const self = item.submitterId === session.user?.id;
  return `<section class="publish-card portal-detail" aria-labelledby="detail-heading"><div class="publish-section"><div class="portal-section-heading"><h2 id="detail-heading">${esc(item.name)} <span>v${esc(item.version)}</span></h2><button class="text-button" data-close-detail>关闭详情</button></div><p class="field-note">提交人 ${esc(item.submitterName)} · ${esc(statuses[item.status] ?? item.status)}${item.reviewerName ? ' · 审核人 '+esc(item.reviewerName) : ''}</p><p class="portal-description">${esc(item.description)}</p><h3 class="portal-small-heading">请求权限 <span>绿色标记为相较上一版新增</span></h3><div class="permission-list">${permissions.length ? permissions.map(permission => `<span class="permission ${previous.includes(permission) ? '' : 'added'}">${previous.includes(permission) ? '' : '+ '}${esc(permission)}</span>`).join('') : '<span class="field-note">未声明权限</span>'}</div>${item.reason ? `<p class="portal-reason">处理说明：${esc(item.reason)}</p>` : ''}<a class="quiet-link" href="/api/submissions/${pathId(item.id)}/package" download>下载提交的源码 ZIP ↓</a><details class="file-details"><summary>查看 ${detail.files.length} 个文件及 SHA-256</summary><div class="file-list">${detail.files.map(file => `<div><strong>${esc(file.path)}</strong><span>${fileSize(file.bytes)}</span><code>${esc(file.sha256)}</code></div>`).join('')}</div></details>${detail.history?.length ? `<details class="file-details"><summary>处理记录（${detail.history.length}）</summary><div class="file-list">${detail.history.map(event => `<div><strong>${esc(event.actorName)} · ${esc(event.action)}</strong><span>${esc(event.createdAt)}</span><code>${esc(event.detail)}</code></div>`).join('')}</div></details>` : ''}</div>
    ${item.status === 'pending' && canReview() ? self ? '<div class="publish-section"><p class="field-note">不能审核自己提交的版本，请由另一位审核员处理。</p></div>' : `<form class="publish-section" id="review-form" data-id="${esc(item.id)}"><label class="publish-field"><span>审核说明</span><textarea name="reason" maxlength="1000" placeholder="说明审核结论；驳回时请写明需要修改的问题。"></textarea></label><div class="portal-form-actions"><button class="button secondary" name="decision" value="rejected" type="submit">驳回</button><button class="button" name="decision" value="approved" type="submit">批准发布</button></div></form>` : ''}
    ${item.status === 'approved' && session.user?.role === 'admin' ? `<form class="publish-section" id="unpublish-form" data-id="${esc(item.id)}"><label class="publish-field"><span>下架原因</span><textarea name="reason" maxlength="1000" required placeholder="填写下架原因，保留审核记录。"></textarea></label><div class="portal-form-actions"><button class="button secondary" type="submit">下架此版本</button></div></form>` : ''}</section>`;
}
function submissionsView() {
  return `${uploadView()}<div class="portal-section-heading"><h2>${canReview() ? '审核与发布记录' : '我的提交'} <span>${submissions.length}</span></h2><button class="text-button" data-refresh>刷新列表</button></div><div class="submission-list">${submissions.length ? submissions.map(item => `<button class="submission-row" data-detail="${esc(item.id)}"><span><strong>${esc(item.name)}</strong><small>v${esc(item.version)} · ${esc(item.submitterName)}</small></span><span class="submission-status ${esc(item.status)}">${esc(statuses[item.status] ?? item.status)}</span><span class="submission-arrow" aria-hidden="true">↗</span></button>`).join('') : '<div class="portal-empty">还没有提交记录。</div>'}</div>${detailView()}`;
}
function usersView() {
  return `<form class="publish-card" id="create-user-form"><div class="publish-section"><div class="publish-section-title"><span>+</span><h2>创建账号</h2></div><div class="user-field-grid"><label class="publish-field"><span>用户名</span><input name="username" required autocomplete="off" minlength="3" maxlength="40" pattern="[a-z0-9][a-z0-9_\\x2d]{2,39}" title="3–40 位小写字母、数字、下划线或连字符，首位为字母或数字"></label><label class="publish-field"><span>初始密码</span><input name="password" type="password" required autocomplete="new-password" minlength="12" maxlength="128"></label><label class="publish-field"><span>用户角色</span><select name="role">${roleOptions()}</select></label></div><div class="portal-form-actions"><button class="button" type="submit">创建账号</button></div></div></form><div class="portal-section-heading" style="margin-top:28px"><h2>用户管理 <span>${users.length}</span></h2></div><div class="user-list">${users.map(user => `<article class="publish-card user-card"><div class="user-card-heading"><div><h3>${esc(user.username)}${user.id === session.user?.id ? ' <small>当前账号</small>' : ''}</h3><span class="field-note">${user.disabled ? '已停用' : '正常'} · ${esc(roleNames[user.role])}</span></div><button class="text-button" data-toggle-user="${esc(user.id)}" data-disabled="${!user.disabled}">${user.disabled ? '启用账号' : '停用账号'}</button></div><form class="user-role-form" data-user-role="${esc(user.id)}"><label><span class="visually-hidden">${esc(user.username)}的角色</span><select name="role">${roleOptions(user.role)}</select></label><button class="button secondary small" type="submit">保存角色</button></form><details><summary>重置密码</summary><form class="reset-password-form" data-reset-password="${esc(user.id)}"><label class="publish-field"><span class="visually-hidden">新密码</span><input name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="128" placeholder="输入新密码，至少 12 位"></label><button class="button secondary small" type="submit">重置密码</button></form></details></article>`).join('')}</div>`;
}
function render() {
  const focused = document.activeElement?.id === 'catalog-search';
  const position = focused ? (document.activeElement as HTMLInputElement).selectionStart : null;
  root.innerHTML = `<div class="publish-shell"><header class="publish-header"><div class="publish-header-brand"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true">◇</span><span class="brand-text">SPACE</span></a><span class="brand-caption">扩展发布中心</span></div><a class="quiet-link" href="/">返回扩展工作台 ↗</a></header><main><div class="publish-heading"><div><p class="eyebrow">GOOD TOOLS DESERVE TO BE SHARED</p><h1>让好工具，被更多人看见。</h1><p>提交、审核、发布。给团队的浏览器，添一点新的可能。</p></div><span class="publisher-label">${session.user ? `${esc(session.user.username)} · ${esc(roleNames[session.user.role])}` : '无需登录即可浏览下载'}</span></div><div class="publish-layout"><div class="portal-main"><nav class="portal-tabs" aria-label="发布中心导航"><button data-page="catalog" ${page === 'catalog' ? 'aria-current="page"' : ''}>扩展目录</button>${canSubmit() ? `<button data-page="submissions" ${page === 'submissions' ? 'aria-current="page"' : ''}>${canReview() ? '提交与审核' : '我的提交'}</button>` : ''}${session.user?.role === 'admin' ? `<button data-page="users" ${page === 'users' ? 'aria-current="page"' : ''}>用户管理</button>` : ''}</nav><div id="portal-message" class="publish-message" role="status" aria-live="polite"></div>${page === 'catalog' ? catalogView() : page === 'submissions' ? submissionsView() : usersView()}</div><aside class="publish-aside">${session.user ? `<section class="publish-current"><h2>已登录</h2><div class="current-extension"><div class="extension-icon" aria-hidden="true">${esc(session.user.username.slice(0,1).toUpperCase())}</div><div><h3>${esc(session.user.username)}</h3><p>${esc(roleNames[session.user.role])}</p></div></div><button class="button secondary small" id="logout">退出登录</button></section>` : `<form class="publish-current" id="login-form"><h2>发布者登录</h2><label class="publish-field"><span>用户名</span><input name="username" autocomplete="username" required minlength="3" maxlength="40" pattern="[a-z0-9][a-z0-9_\\x2d]{2,39}" title="3–40 位小写字母、数字、下划线或连字符，首位为字母或数字"></label><label class="publish-field"><span>密码</span><input type="password" name="password" autocomplete="current-password" required maxlength="128"></label><button class="button portal-login-button" type="submit">登录</button><p class="field-note">账号由管理员创建。浏览和下载已发布扩展无需登录。</p></form>`}<section class="publish-help"><p class="eyebrow">FROM YOUR TEAM, FOR YOUR TEAM</p><h2>每一个版本，<br>都有迹可循。</h2><ol><li>开发者提交 ZIP，保留固定扩展身份。</li><li>审核员检查权限变更和源码，独立审核。</li><li>通过后公开下载，保留版本与处理记录。</li></ol><p>这里提供开发者模式扩展包。首次安装需手动加载；之后可连接原目录更新，必要时手动重新加载。</p></section></aside></div></main><footer class="publish-footer"><span>SPACE / 从一个小工具，到团队的日常。</span><span>版本可追溯 · 权限可检查 · 人工审核</span></footer></div>`;
  bind();
  if (focused) { const input = root.querySelector<HTMLInputElement>('#catalog-search'); input?.focus(); if (position !== null) input?.setSelectionRange(position,position); }
}
function formData(form: HTMLFormElement) { return new FormData(form); }
async function afterWrite(message: string) { session = await api<Session>('/api/session'); if (!session.user || (page === 'users' && session.user.role !== 'admin')) { page = 'catalog'; detail = null; } await load(); if (detail) detail = await api<Detail>(`/api/submissions/${pathId(detail.submission.id)}`); render(); notice(message); }
function bind() {
  root.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(button => button.addEventListener('click', () => { if (busy) return; page = button.dataset.page as typeof page; detail = null; render(); }));
  root.querySelector<HTMLInputElement>('#catalog-search')?.addEventListener('input', event => { query = (event.target as HTMLInputElement).value; render(); });
  root.querySelector<HTMLFormElement>('#login-form')?.addEventListener('submit', event => { event.preventDefault(); const data = formData(event.currentTarget as HTMLFormElement); void run(async () => { session = await api<Session>('/api/login',json('POST',{username:data.get('username'),password:data.get('password')})); await load(); render(); notice('登录成功。'); }); });
  root.querySelector('#logout')?.addEventListener('click', () => void run(async () => { await api('/api/logout',{method:'POST'}); session={user:null}; detail=null; page='catalog'; await load(); render(); notice('已退出登录。'); }));
  root.querySelector<HTMLInputElement>('#zip-file')?.addEventListener('change', event => { const file = (event.target as HTMLInputElement).files?.[0]; root.querySelector('#zip-label')!.textContent = file ? `${file.name} · ${fileSize(file.size)}` : '上传 ZIP'; });
  root.querySelector<HTMLFormElement>('#upload-form')?.addEventListener('submit', event => { event.preventDefault(); const file = (event.currentTarget as HTMLFormElement).querySelector<HTMLInputElement>('[name=package]')?.files?.[0]; if (!file) return; if (file.size > 4*1024*1024) { notice('ZIP 文件不能超过 4 MB。',true); return; } void run(async () => { await api('/api/submissions',{method:'POST',headers:{'Content-Type':'application/zip'},body:file}); await afterWrite('已提交审核。通过审核后会出现在扩展目录中。'); }); });
  root.querySelectorAll<HTMLButtonElement>('[data-detail]').forEach(button => button.addEventListener('click', () => void run(async () => { detail=await api<Detail>(`/api/submissions/${pathId(button.dataset.detail!)}`); render(); root.querySelector('#detail-heading')?.scrollIntoView({block:'start',behavior:'smooth'}); })));
  root.querySelector('[data-close-detail]')?.addEventListener('click', () => { detail=null;render(); });
  root.querySelector('[data-refresh]')?.addEventListener('click', () => void run(async () => { await load();render();notice('已刷新提交记录。'); }));
  root.querySelector<HTMLFormElement>('#review-form')?.addEventListener('submit', event => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; const data=formData(form); const decision=((event as SubmitEvent).submitter as HTMLButtonElement)?.value; const reason=String(data.get('reason')??'').trim(); if (decision !== 'approved' && decision !== 'rejected') return; if (decision==='rejected' && !reason) {notice('请填写驳回原因。',true);return;} void run(async()=> { await api(`/api/submissions/${pathId(form.dataset.id!)}/review`,json('POST',{decision,reason}));await afterWrite(decision==='approved'?'审核通过，版本已发布。':'提交已驳回。'); }); });
  root.querySelector<HTMLFormElement>('#unpublish-form')?.addEventListener('submit', event => { event.preventDefault(); const form=event.currentTarget as HTMLFormElement; const reason=String(formData(form).get('reason')??'').trim(); if(!reason){notice('请填写下架原因。',true);return;} void run(async()=> {await api(`/api/submissions/${pathId(form.dataset.id!)}/unpublish`,json('POST',{reason}));await afterWrite('此版本已下架。');});});
  root.querySelector<HTMLFormElement>('#create-user-form')?.addEventListener('submit', event => { event.preventDefault();const data=formData(event.currentTarget as HTMLFormElement);void run(async()=>{await api('/api/users',json('POST',{username:data.get('username'),password:data.get('password'),role:data.get('role')}));await afterWrite('用户已创建。');});});
  root.querySelectorAll<HTMLFormElement>('[data-user-role]').forEach(form=>form.addEventListener('submit',event=>{event.preventDefault();const role=formData(form).get('role');void run(async()=>{await api(`/api/users/${pathId(form.dataset.userRole!)}`,json('PATCH',{role}));session=await api<Session>('/api/session');if(session.user?.role!=='admin')page='catalog';await afterWrite('用户角色已更新。');});}));
  root.querySelectorAll<HTMLFormElement>('[data-reset-password]').forEach(form=>form.addEventListener('submit',event=>{event.preventDefault();const password=formData(form).get('password');void run(async()=>{await api(`/api/users/${pathId(form.dataset.resetPassword!)}`,json('PATCH',{password}));await afterWrite('密码已重置。');});}));
  root.querySelectorAll<HTMLButtonElement>('[data-toggle-user]').forEach(button=>button.addEventListener('click',()=>void run(async()=>{await api(`/api/users/${pathId(button.dataset.toggleUser!)}`,json('PATCH',{disabled:button.dataset.disabled==='true'}));await afterWrite(button.dataset.disabled==='true'?'用户已停用。':'用户已启用。');})));
}
render();
void run(async()=>{session=await api<Session>('/api/session');await load();render();});
