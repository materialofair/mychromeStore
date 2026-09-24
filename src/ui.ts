import type { Actions, ViewState } from "./view-types";

type Tab = "discover" | "mine" | "guide";
let tab: Tab = "discover";
let search = "";
let copied = false;
const paths: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  box: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8M12 13v9M7 5.8l9 5"/>',
  guide:
    '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4ZM13 7a3 3 0 0 1 3-3h5v15h-5a3 3 0 0 0-3 2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3V7Z"/>',
  note: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  refresh:
    '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  leaf: '<path d="M5 19C0 10 9 3 20 4c1 10-5 18-15 15Zm0 0L16 8"/>',
};
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.box}</svg>`;
const escape = (value: string | null) =>
  (value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const disabled = (value: boolean) => (value ? "disabled" : "");

function guide(): string {
  return `<section class="guide-section" aria-labelledby="guide-heading">
    <div class="section-heading"><h2 id="guide-heading">从本地出发，只需三步 <span>一次连接，轻松更新</span></h2></div>
    <div class="steps">
      <article class="step"><span class="step-number">01</span><div><h3>安装初始版本</h3><p>下载 v1.0.0 并解压，在扩展管理页开启开发者模式，选择「加载解压缩的扩展」。</p><button class="text-button" data-copy>${copied ? "已复制管理页地址" : "复制 edge://extensions"}</button></div></article>
      <article class="step"><span class="step-number">02</span><div><h3>连接本地扩展目录</h3><p>选择刚才加载的文件夹并授予读写权限。请直接选择包含 manifest.json 的目录。</p></div></article>
      <article class="step"><span class="step-number">03</span><div><h3>在这里完成更新</h3><p>点击更新，验证文件并保存备份。若自动重载未完成，请在扩展管理页手动重新加载。</p></div></article>
    </div>
  </section>`;
}

function panel(state: ViewState): string {
  const upToDate = state.diskVersion === state.latestVersion;
  const runningLatest =
    upToDate && state.runtimeVersion === state.latestVersion;
  const unavailable = state.busy || !state.supported || state.recoveryNeeded;
  return `<aside class="status-panel" aria-label="本地更新状态">
    <div class="panel-title"><h2>本地工作区</h2><span class="status-pill ${state.folderName ? "connected" : ""}">${state.folderName ? "已连接目录" : "尚未连接"}</span></div>
    ${state.folderName ? `<div class="folder-name">${icon("folder")}<span>${escape(state.folderName)}</span></div>` : `<div class="folder-empty">${icon("folder")}<strong>连接你的扩展</strong><p>授权访问本地文件夹<br>把更新交给工作台</p></div>`}
    <div class="version-row"><span>商店最新版本</span><strong>v${escape(state.latestVersion)}</strong></div>
    <div class="version-row"><span>本地文件版本</span><strong data-testid="disk-version">${state.diskVersion ? "v" + escape(state.diskVersion) : "等待连接"}</strong></div>
    <div class="version-row"><span>浏览器运行版本</span><strong data-testid="runtime-version">${state.runtimeVersion ? "v" + escape(state.runtimeVersion) : "未检测到"}</strong></div>
    <div class="panel-actions">
      ${state.folderName ? `<button class="button" data-action="update" data-testid="update" ${disabled(unavailable || runningLatest)}>${icon(state.busy ? "refresh" : runningLatest ? "check" : upToDate ? "refresh" : "download")}${state.busy ? "正在处理…" : runningLatest ? "已确认运行最新版" : upToDate ? "重新加载扩展" : "更新至 v" + escape(state.latestVersion)}</button><button class="button secondary small" data-action="refresh" ${disabled(state.busy)}>${icon("refresh")}刷新运行状态</button><button class="text-button" data-action="bind" ${disabled(unavailable)}>更换扩展目录</button>` : `<button class="button" data-action="bind" data-testid="bind" ${disabled(unavailable)}>${icon("folder")}连接本地目录</button>`}
    </div>
    <p class="panel-hint">文件更新后，需要重新加载扩展才能运行新版。浏览器可能再次请求目录授权。</p>
    <div role="status" aria-live="polite" aria-atomic="true" ${state.message ? `class="state-message ${state.phase === "error" ? "error" : ""}"` : ""}>${escape(state.message)}</div>
    ${state.busy ? `<progress class="progress" max="100" value="${Math.max(0, Math.min(100, state.progress))}" aria-label="更新进度"></progress>` : ""}
    ${state.phase === "manual" ? `<button class="text-button" data-copy>${copied ? "已复制管理页地址" : "复制 edge://extensions，手动重新加载"}</button>` : ""}
    ${state.hasBackup ? `<div class="backup-tools"><button class="text-button" data-action="restore" data-testid="restore" ${disabled(state.busy)}>恢复更新前的文件</button><button class="text-button" data-action="downloadBackup" ${disabled(state.busy)}>下载备份</button></div>` : ""}
  </aside>`;
}

export function renderApp(state: ViewState, actions: Actions): void {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) return;
  const searchFocused = document.activeElement?.id === "store-search";
  const selection = searchFocused
    ? (document.activeElement as HTMLInputElement).selectionStart
    : null;
  const matches =
    !search.trim() ||
    "focus notes 专注便签 笔记 效率工具 本地 demo".includes(
      search.toLowerCase().trim(),
    );
  const title =
    tab === "mine"
      ? "我的扩展"
      : tab === "guide"
        ? "让第一次连接，更简单。"
        : "你的浏览器，刚刚好。";
  const sub =
    tab === "mine"
      ? "连接本地扩展，查看文件与运行状态。"
      : tab === "guide"
        ? "保留熟悉的开发者模式，让之后的更新少走几步。"
        : "发现好用的工具，让本地扩展保持新鲜。";
  root.innerHTML = `<div class="layout">
    <aside class="sidebar"><a class="brand" href="#discover" data-tab="discover" aria-label="SPACE 首页"><span class="brand-mark">${icon("box")}</span><span class="brand-text">SPACE</span></a><p class="brand-caption">扩展工作台</p><p class="nav-label">WORKSPACE</p>
      <nav class="nav" aria-label="主导航">${(["discover", "mine", "guide"] as Tab[]).map((item, i) => `<button data-tab="${item}" class="${item === tab ? "active" : ""}" ${item === tab ? 'aria-current="page"' : ""} aria-label="${["发现扩展", "我的扩展", "安装指南"][i]}">${icon(["grid", "box", "guide"][i])}<span>${["发现扩展", "我的扩展", "安装指南"][i]}</span><span>${item === "mine" && state.folderName ? "1" : ""}</span></button>`).join("")}</nav>
      <div class="sidebar-bottom"><div class="local-note"><strong><span class="dot"></span>属于你的本地空间</strong>扩展保存在你的设备上。<br>每次更新，都由你决定。</div></div>
    </aside>
    <div class="workspace"><header class="topbar"><div class="breadcrumb">工作空间<span>/</span><strong>${tab === "discover" ? "发现扩展" : tab === "mine" ? "我的扩展" : "安装指南"}</strong></div><div class="top-right"><label class="search">${icon("search")}<span class="visually-hidden">搜索扩展</span><input id="store-search" type="search" placeholder="搜索扩展，找到一点灵感…" value="${escape(search)}" autocomplete="off"></label><span class="environment"><span class="dot"></span>本地扩展工作台</span><span class="avatar" aria-label="本地工作区">S</span></div></header>
    <main class="content"><div class="page-heading"><div><p class="eyebrow">${tab === "guide" ? "A LITTLE GUIDANCE" : "MAKE ROOM FOR GOOD TOOLS"}</p><h1>${title}</h1><p>${sub}</p></div>${tab !== "guide" ? `<button class="quiet-link" data-tab="guide">首次使用？${icon("arrow")}</button>` : ""}</div>
    ${!state.supported ? '<div class="support-warning" role="alert">当前环境不支持本地目录更新。请使用桌面版 Edge，在 HTTPS 或 localhost 打开工作台。你仍可下载扩展并手动加载。</div>' : ""}
    ${state.recoveryNeeded ? `<div class="recovery" role="alert"><div><strong>有一次文件更新尚未完成</strong>请先恢复备份，再继续更新。恢复完成前，请不要重新加载扩展。</div><button class="button secondary" data-action="restore" ${disabled(state.busy)}>恢复原始文件</button></div>` : ""}
    ${tab === "discover" && !search ? `<section class="hero" aria-label="本地扩展更新介绍"><div class="hero-copy"><div class="hero-label"><span class="dot"></span>小工具 · 大一点的从容</div><h2>好用的扩展，<br><em>值得一直保持更新。</em></h2><p>连接你的本地扩展目录。下载、备份、更新，<br>在一个熟悉的地方完成。</p><button class="button lime" data-action="bind" ${disabled(state.busy || !state.supported || state.recoveryNeeded)}>连接我的扩展${icon("arrow")}</button></div><div class="hero-art" aria-hidden="true"><div class="orbit"></div><span class="spark">✳</span><div class="note-preview"><div class="preview-top"><span>FOCUS NOTES</span>${icon("note")}</div><p class="preview-title">留一点空间，<br>给重要的事。</p><div class="preview-item done"><span class="check-box"></span>整理今天的灵感</div><div class="preview-item"><span class="check-box"></span>专注做好一件小事</div><div class="preview-bottom"><span>在本地，安心记录</span><span>✦</span></div></div><div class="version-float">${icon("check")}为下一次灵感准备好</div></div></section>` : ""}
    ${tab === "guide" ? `<div class="guide-page">${guide()}<div class="guide-detail"><h2>开始体验 Focus Notes</h2><p>先下载并解压 v1.0.0，保留这个文件夹；浏览器和工作台都需要指向同一个目录。打开扩展写一条便签，再回到工作台更新至 v${escape(state.latestVersion)}，检查便签是否仍然保留。</p><a class="button secondary" href="/releases/focus-notes-1.0.0.zip" download>${icon("download")}下载初始版本 v1.0.0</a><h2 style="margin-top:24px">为什么需要手动安装第一次？</h2><p>此工作台服务于已经通过开发者模式加载的本地扩展。网页不能直接替你安装扩展或开启开发者模式。自动重新加载需要扩展支持本站通信；若未检测到扩展，请复制 <code>edge://extensions</code> 到地址栏，在扩展卡片上点击重新加载。</p><p>连接目录仅授予网站对所选文件夹的访问权。建议使用专用文件夹，更新前不要手工修改已发布的扩展文件。关闭网站后，不会在后台更新。</p></div></div>` : `<div class="section-heading"><h2>${tab === "mine" ? "已连接的扩展" : "精选扩展"}<span>${tab === "mine" && !state.folderName ? "等待连接" : "为专注而生"}</span></h2><span class="filter">本地 · 效率工具</span></div><div class="main-grid"><section aria-label="扩展列表">${!matches ? `<div class="empty-state">没有找到匹配的扩展<p>试试搜索「Focus Notes」或「便签」。</p><button class="button secondary small" data-clear-search>清除搜索</button></div>` : tab === "mine" && !state.folderName ? `<div class="empty-state">还没有连接本地扩展<p>从右侧选择已加载的扩展目录，就可以查看更新。</p><button class="button secondary" data-tab="guide">查看安装指南${icon("arrow")}</button></div>` : `<article class="extension-card"><div class="card-top"><div class="extension-icon">${icon("note")}</div><div class="card-title"><h3>Focus Notes</h3><p>专注便签 · SPACE DEMO</p></div><span class="version-badge">v${escape(state.latestVersion)}</span></div><p class="card-description">给随手的灵感一个安静的角落。轻点浏览器中的扩展图标，记录待办、想法和今天最重要的一件事。</p><div class="tags"><span>效率工具</span><span>本地存储</span><span>演示扩展</span></div><div class="release-note card-divider"><strong>${icon("leaf")}v${escape(state.latestVersion)} · 新的专注体验</strong>更新便签外观与主题体验，保留本地记录。</div><div class="card-footer"><small>首次安装，从 v1.0.0 开始<br>随后连接目录，体验在线更新</small><a class="button secondary small" href="/releases/focus-notes-1.0.0.zip" download>${icon("download")}下载体验版</a></div></article>`}</section>${panel(state)}</div>${guide()}`}
    <footer class="footer"><span>SPACE / 让工具回归简单，让浏览器更像你。</span><span>开发者模式 · 本地文件更新 · 用户授权</span></footer></main></div></div>`;

  root.querySelectorAll<HTMLElement>("[data-tab]").forEach((element) =>
    element.addEventListener("click", (event) => {
      event.preventDefault();
      tab = element.dataset.tab as Tab;
      search = "";
      renderApp(state, actions);
    }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((element) =>
    element.addEventListener("click", () => {
      const action = element.dataset.action as keyof Actions;
      void actions[action]();
    }),
  );
  root
    .querySelector<HTMLInputElement>("#store-search")
    ?.addEventListener("input", (event) => {
      search = (event.target as HTMLInputElement).value;
      if (tab === "guide") tab = "discover";
      renderApp(state, actions);
    });
  root.querySelector("[data-clear-search]")?.addEventListener("click", () => {
    search = "";
    renderApp(state, actions);
  });
  root.querySelectorAll("[data-copy]").forEach((button) =>
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText("edge://extensions");
        copied = true;
        renderApp(state, actions);
      } catch {
        (button as HTMLButtonElement).textContent =
          "请手动在地址栏输入 edge://extensions";
      }
    }),
  );
  if (searchFocused) {
    const input = root.querySelector<HTMLInputElement>("#store-search");
    input?.focus();
    if (selection !== null) input?.setSelectionRange(selection, selection);
  }
}
