# SPACE · 本地扩展工作台

一个包含开发者上传、审核发布和公开下载的中文扩展商店，以及配套的 **Focus Notes 专注便签** Manifest V3 Demo。本地更新面板目前仅接入该 Demo。

保留第一次手动加载的方式；日常更新由网站在你授权的原始扩展目录中完成。无需管理员权限，不配置企业策略。本地更新操作不上传你的目录或笔记；开发者主动提交的 ZIP 会上传到发布后台。

## 本机启动

需要 Node.js 22.13+（推荐 Node 24 LTS）和桌面版 Edge / Chrome。

```bash
npm ci
npm run admin:create  # 首次运行：终端交互创建管理员
npm run dev
```

打开 **http://localhost:5173**。发布中心在 **http://localhost:5173/publish.html**。默认后台只接受 localhost 来源；请始终使用同一个地址，避免登录来源和目录授权不一致。

管理员在发布中心创建开发者、审核员账号。开发者提交 ZIP，审核员批准后才会公开；每个版本单独审核，不能批准自己的上传。详细步骤与上传示例见 [上传与审核指南](docs/publishing.md)。

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

- 管理员建号、角色授权、开发者上传、逐版本审核与下架。
- 多扩展公开目录；未批准版本的 ZIP 和 JSON 不对外开放。
- 私有数据库保存扩展包和审核记录；会话、CSRF、上传限额及结构验证。
- 响应式扩展目录、搜索、「我的扩展」和安装指南。
- 原生目录选择与授权，IndexedDB 保存目录句柄。
- 区分文件版本与运行版本；只有扩展回应目标版本才显示运行新版。
- SHA-256 校验、身份校验、路径/体积限制、保护本地改动和未管理文件。
- 更新前持久化备份；中断后阻止新更新，提供恢复与下载。
- 跨标签页更新锁；所有写入结束并回读校验后才重载。
- 固定 Demo ID、严格来源检查、仅开放 PING/RELOAD 消息。
- 本地笔记保存、1.1 纸张主题、版本回退验证。

## 部署到自己的 HTTPS 域名

完整商店需要 Node 后端与 SQLite。**先确定域名，再构建并启动服务**。以下为 macOS/Linux shell 示例：

```bash
STORE_ORIGIN=https://extensions.example.com npm run build
TRUST_PROXY=1 STORE_ORIGIN=https://extensions.example.com npm start
```

PowerShell：

```powershell
$env:STORE_ORIGIN = "https://extensions.example.com"
$env:TRUST_PROXY = "1" # 使用示例 Nginx 反向代理时
npm run build
npm start
```

通过 HTTPS 反向代理转发到本机 8787，后端提供 `dist/` 和 API，部署在该域名的**网站根路径**。不是 `file://`，也不是普通 HTTP 局域网 IP。`STORE_ORIGIN` 必须为完整来源、不含路径或末尾 `/`。该构建的 Demo 只允许配置的来源；网站和下载的扩展包必须来自同一次构建。

发布域名变化后，旧 Demo 的通信来源不会自动改变。请使用新域名构建的 ZIP，首次重新加载/接入一次。不要直接用旧部署地址的已安装包去更新新部署生成的不同内容——本地文件完整性校验会阻止覆盖。

示例托管头部见 `deploy/nginx.conf`。正式供同事使用前可在反向代理层接入企业允许的访问控制；账号、上传与审核由发布中心管理。普通网页登录可用于这个网页主动下载方案，它不使用 Edge 原生 update_url 协议。

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
server/                    账号、上传、审核 API 与私有数据库
src/publish.ts / publish.css 发布中心页面
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

- 发布中心支持多个经过审核的 MV3 扩展。每个已发布扩展都有独立的安装与更新页，目录和备份按扩展 ID 隔离。首次需手动加载；未集成桥接的扩展更新文件后需手动重载。
- 两个版本公用模板，通过 manifest 版本启用 1.1 的主题功能。这是明确的演示方式；生产发布应保存不可变的每版源码/构建产物，不能重写历史版本。
- 目录写入不是原子操作。请勿在更新中手动改文件或重载扩展；异常时优先恢复。恢复备份只保留最近一次事务，不包括浏览器笔记存储。
- 备份位于本站 IndexedDB；清理站点数据、无痕窗口关闭或存储被系统回收会丢失。重要更新前可下载备份，保留原始 ZIP；不保证无条件恢复。
- 网站不能证明选中的目录就是浏览器加载的目录。固定 ID 与版本回应只证明扩展身份/运行版本；若选择了副本，更新文件不会改变实际加载目录，界面会区分显示。
- 校验值防止损坏，不是独立发布签名。拥有网站发布权限的人可以发布代码，应保护部署来源和访问控制。
- 企业 Windows Edge 实际策略/版本尚未实测；已在 macOS Chromium 完成真实原生目录授权与更新验收。

## 开源协议

本项目采用 [MIT License](LICENSE)，允许使用、修改和分发；分发时请保留版权声明和许可文本。

## SPACE AI / browsa

已提供保留 browsa 侧栏与原模型配置的独立适配包，支持自定义 OpenAI-compatible Base URL、模型和 API Key。

```sh
npm run browsa:build
```

产物位于 `.data/packages/space-browsa-1.0.0.zip`，通过发布中心上传并独立审核后公开。详细构建、安装和配置见 [SPACE AI 指南](extensions/space-browsa/README.md)。上游 MIT 与第三方许可随包保留，不将第三方组件统一重新许可为 MIT。
