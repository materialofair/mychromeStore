# SPACE · 本地扩展工作台

一个可以实际更新本地解压扩展的中文网站，以及配套的 **Focus Notes 专注便签** Manifest V3 Demo。

保留第一次手动加载的方式；日常更新由网站在你授权的原始扩展目录中完成。无需管理员权限，不配置企业策略。网站不上传本地文件或笔记。

## 本机启动

需要 Node.js 22.12+（推荐 Node 24 LTS）和桌面版 Edge / Chrome。

```bash
npm ci
npm run dev
```

打开 **http://localhost:5173**。默认也允许 http://127.0.0.1:5173，但这两个来源的目录授权和备份各自独立，建议始终使用同一个地址。

## 体验完整更新

1. 在网站下载 **v1.0.0 体验版 ZIP**，解压到专用文件夹，例如 `Documents/space-demo`。
2. 在 Edge 地址栏手动打开 `edge://extensions`，开启开发者模式，选择「加载解压缩的扩展」，选中刚解压的目录。
3. 打开 Focus Notes，写一条便签。
4. 返回网站点击「连接本地目录」，选择**同一个目录**，允许读写。
5. 点击「更新至 v1.1.0」。网站校验文件、保存备份、更新目录，随后通知扩展重载，并核对实际运行版本。
6. 再打开扩展：便签仍在，1.1 增加「切换纸张颜色」。可以在网站下载备份或恢复更新前的文件。

浏览器在扩展重载时会关闭扩展弹窗/页面，这是正常行为。首次安装仍必须手动加载，后续需要保持开发者模式。若浏览器策略禁止相应能力，网站会显示错误或手动操作说明。

`demo/focus-notes-1.0.0/` 与 `demo/focus-notes-1.1.0/` 是生成的参考目录，**不要把它们作为长期安装目录**：每次 `npm run dev/build/releases` 都会重新生成。请解压网站下载的 ZIP 到项目外独立目录。

## 已实现

- 响应式扩展目录、搜索、「我的扩展」和安装指南。
- 原生目录选择与授权，IndexedDB 保存目录句柄。
- 区分文件版本与运行版本；只有扩展回应目标版本才显示运行新版。
- SHA-256 校验、身份校验、路径/体积限制、保护本地改动和未管理文件。
- 更新前持久化备份；中断后阻止新更新，提供恢复与下载。
- 跨标签页更新锁；所有写入结束并回读校验后才重载。
- 固定 Demo ID、严格来源检查、仅开放 PING/RELOAD 消息。
- 本地笔记保存、1.1 纸张主题、版本回退验证。

## 部署到自己的 HTTPS 域名

这是静态站点，不需要数据库。**先确定域名，再生成扩展包**。以下为 macOS/Linux shell 示例：

```bash
STORE_ORIGIN=https://extensions.example.com npm run build
```

PowerShell：

```powershell
$env:STORE_ORIGIN = "https://extensions.example.com"
npm run build
```

将 `dist/` 内容托管到该 HTTPS 域名的**网站根路径**。不是 `file://`，也不是普通 HTTP 局域网 IP。`STORE_ORIGIN` 必须为完整来源、不含路径或末尾 `/`。该构建的 Demo 只允许配置的来源；网站和下载的扩展包必须来自同一次构建。

发布域名变化后，旧 Demo 的通信来源不会自动改变。请使用新域名构建的 ZIP，首次重新加载/接入一次。不要直接用旧部署地址的已安装包去更新新部署生成的不同内容——本地文件完整性校验会阻止覆盖。

示例托管头部见 `deploy/nginx.conf`。正式供同事使用前可在反向代理层接入企业允许的访问控制；本版本没有账号或上传后台。普通网页登录可用于这个网页主动下载方案，它不使用 Edge 原生 update_url 协议。

## 开发与验证

```bash
npm run check
npm test
npm run build
npm audit --audit-level=moderate
npx playwright install chromium
npm run test:e2e
```

如使用已有的测试浏览器，可设置 `CHROMIUM_PATH` 指向其可执行文件。自动测试用独立临时浏览器配置和目录，不修改日常浏览器资料。

原生目录选择完整验收：

```bash
node scripts/manual-browser-proof.mjs
```

脚本会启动隔离测试浏览器，输出临时 Demo 目录。**仅在弹出的选择框中选择脚本输出的目录**并允许修改，脚本随后验证更新、重载、便签保留、刷新后目录恢复与回退。结束后关闭该测试浏览器并清理临时目录。可以按需同样设置 `CHROMIUM_PATH`。

验证记录与已知边界见 [docs/verification.md](docs/verification.md)。

## 项目结构

```text
src/core.ts                文件校验、备份事务、更新与恢复
src/storage.ts             IndexedDB 与跨标签页互斥
src/bridge.ts              网站与扩展的通信/运行版本确认
src/main.ts                用户操作与状态协调
src/ui.ts / style.css      中文工作台
src/view-types.ts          界面状态契约
demo/template/             Demo 源码（公共源模板）
demo/identity.json         固定 ID 用的公开 key（不是私钥）
scripts/build-releases.mjs  生成两个 Demo 版本、ZIP、版本索引
public/releases/           可托管的版本清单和下载包
tests/                    单元、故障注入与浏览器测试
```

## 适用边界

- 当前是单个自有 Demo 的完整 MVP；接入其他扩展需要其身份、版本文件清单和对应通信代码，不能任意管理第三方扩展。
- 两个版本公用模板，通过 manifest 版本启用 1.1 的主题功能。这是明确的演示方式；生产发布应保存不可变的每版源码/构建产物，不能重写历史版本。
- 目录写入不是原子操作。请勿在更新中手动改文件或重载扩展；异常时优先恢复。恢复备份只保留最近一次事务，不包括浏览器笔记存储。
- 备份位于本站 IndexedDB；清理站点数据、无痕窗口关闭或存储被系统回收会丢失。重要更新前可下载备份，保留原始 ZIP；不保证无条件恢复。
- 网站不能证明选中的目录就是浏览器加载的目录。固定 ID 与版本回应只证明扩展身份/运行版本；若选择了副本，更新文件不会改变实际加载目录，界面会区分显示。
- 校验值防止损坏，不是独立发布签名。拥有网站发布权限的人可以发布代码，应保护部署来源和访问控制。
- 企业 Windows Edge 实际策略/版本尚未实测；已在 macOS Chromium 完成真实原生目录授权与更新验收。

## 开源协议

本项目采用 [MIT License](LICENSE)，允许使用、修改和分发；分发时请保留版权声明和许可文本。
