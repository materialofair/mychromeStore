# 项目 Agent 工作指南

本文件适用于整个仓库。先遵循当前任务中的用户要求，再结合此处约束工作；更具体的子目录指南只适用于其目录。默认用中文沟通，代码和命名遵循所在文件风格。

## 项目定位与事实来源

SPACE 是面向无管理员权限用户的浏览器扩展商店，包含账号、上传、独立审核、公开下载和本地目录更新。SPACE AI 是基于开源 browsa 的独立适配扩展；Focus Notes 是用于验证更新链路的 Demo。

- 首次安装需用户开启开发者模式并手动加载解压目录。网站不能静默安装扩展，也不是 Edge/Chrome 官方商店或企业策略分发服务。
- 已安装扩展通过用户授权的目录进行文件更新。集成桥接时可请求重载并核对运行版本，否则提示手动重载。
- 商店与自有适配代码采用 MIT；保留 browsa 和第三方组件各自的版权与许可证。未使用 Sider 的代码。
- 实现以当前源码、配置和测试为准。`docs/plans/`、研究文档和旧验收记录可能描述历史状态，不代表全部已实现。
- 优先阅读相关文件：`README.md`、`docs/publishing.md`、`extensions/space-browsa/README.md`、`docs/verification.md`。文档与实现冲突时，查证后只修正本次涉及的部分。

## 开始工作

1. 查看 `git status --short`，识别用户已有修改；不要覆盖、重置或混入无关改动。
2. 阅读受影响的入口、实现、测试及配置，先定位再修改。文本和文件搜索优先用 `rg`。
3. 将需求落实为可验证的行为；对权限、数据保留、发布范围等实质性歧义先澄清。已明确授权的常规工作直接推进。
4. 保持改动聚焦，不顺带更换框架、格式化全仓库或重构无关模块。引入依赖前检查现有实现能否满足需求。
5. 功能或缺陷修改补充有意义的回归验证。纯文档修改只需核对事实、路径、命令和 diff，无需运行整套浏览器测试。

## 技术栈与代码地图

Node.js >= 22.13、npm（使用锁文件）、TypeScript/ES modules、Vite 多页前端、Node HTTP 后端和内置 SQLite。前端不是 React 项目。Vitest 用于单元及服务测试，Playwright 用于浏览器验收。

| 路径 | 职责 / 修改入口 |
| --- | --- |
| `src/main.ts`、`src/ui.ts`、`src/style.css` | 商店首页与 Focus Notes 更新交互 |
| `src/publish.ts`、`src/publish.css` | 上传、审批与账号管理页面 |
| `src/update.ts`、`src/update-identity.ts`、`src/update.css` | 已发布扩展的独立安装与更新页 |
| `src/core.ts` | 文件校验、备份、更新与恢复事务 |
| `src/storage.ts` | IndexedDB、目录句柄、按扩展隔离的状态与锁 |
| `src/bridge.ts` | 与扩展通信、重载和运行版本确认 |
| `server/app.ts`、`server/auth.ts`、`server/db.ts` | API、权限、会话、审核与持久化 |
| `server/package.ts` | 不可信 ZIP 和 manifest 的严格校验 |
| `demo/template/`、`demo/identity.json` | Demo 源模板与固定公开身份 |
| `scripts/build-releases.mjs` | 生成 Demo 目录、ZIP 和版本索引 |
| `extensions/space-browsa/` | SPACE AI 的上游锁定、依赖锁、补丁、身份与许可 |
| `scripts/build-browsa.mjs` | SPACE AI 干净源码导出、补丁应用、验证与打包 |
| `tests/`、`tests/e2e/` | 单元、故障注入、平台及实际扩展浏览器测试 |

## 运行与构建

```sh
npm ci
npm run dev                 # Vite 5173 + API 8787
npm run check               # TypeScript
npm test                    # Vitest
npm run build               # Demo 产物 + 类型检查 + 网站构建
npm audit --audit-level=moderate
npm run test:e2e            # Playwright
npm run browsa:build        # 单独构建完整 SPACE AI
```

- 统一使用 `http://localhost:5173`，不要混用 `127.0.0.1`，否则来源校验、登录或目录授权可能不同。
- 首次管理员通过 `npm run admin:create` 在本地终端交互建立；不要自动创建用户真实数据库中的测试账号。
- Playwright 需要可用的 Chromium；可用 `npx playwright install chromium`，或通过 `CHROMIUM_PATH` 指定测试浏览器。配置会复用已运行的开发服务，测试前确认其对应当前工作区。
- `npm run dev/build/releases` 会重新生成 Demo 目录和发布文件。不能把这些目录当作用户长期加载目录；检查生成文件 diff，避免提交仅 ZIP 时间戳变化。恢复此类产物前先确认内容没有变化，不能盲目还原。
- 生产网站和扩展构建均使用相同的 `STORE_ORIGIN`。线上必须为精确 HTTPS origin，不带路径或末尾斜杠；不要放宽为通配来源。
- `dist/`、`.data/`、浏览器资料和测试报告是生成或私有数据，不是源码。正式服务需要后端和 SQLite，不能只发布静态网站。

## 不可破坏的行为约束

### 上传与审核

- 只有授权开发者或管理员可上传。每个版本独立审核，上传者不能批准自己的提交，包括管理员。
- 扩展归属、版本不可覆盖、角色权限必须由后端校验，不能只依赖前端按钮。
- 未批准、被驳回或已下架的包及版本 JSON 不得通过公开接口泄漏；已下架版本不能通过直链绕过限制。
- ZIP 是不可信输入：保留路径、重名、软链接、压缩/解压体积及条目数限制。不能为让某个大包通过而直接取消限制。
- 结构校验不是恶意代码检测；不要声称自动审核已保证代码安全。

### 本地更新与数据保留

- 修改文件前验证扩展身份、版本、内容和路径；保护本地改动及非受管文件。
- 更新前持久化备份和事务状态；中断后阻止新更新，提供恢复。跨标签页互斥、按扩展 ID 隔离的目录/备份/锁不能移除。
- 所有写入及回读校验完成后才重载。区分“文件已更新”和“浏览器正在运行新版”，不以消息发出即认定成功。
- 网站无法证明选中目录就是浏览器加载的目录。文件写入不是原子操作，IndexedDB 备份也不是永久保证。
- 本地备份的恢复不能依赖旧版本仍在公开目录中；恢复时仍需验证备份身份和本地冲突。
- 固定 `manifest.key` 决定扩展 ID；升级不要重新生成身份或清空 `chrome.storage.local`。公开 key 不是秘密，也不是发布者签名证明。
- 桥接只开放既有 PING/RELOAD 能力，并校验精确来源与身份。不得通过商店桥接读取 API Key、聊天记录或网页正文。

### SPACE AI 开发

- 修改 `extensions/space-browsa/` 的可追踪配方和补丁，不直接修改 `.data/browsa-upstream`、临时构建目录或已安装扩展。构建从固定 Git commit 导出源码，缓存工作树修改不会进入产物。
- 上游提交和版本以 `upstream.json` 为准，不凭文档中的旧版本硬编码。补丁锚点失配应停止构建，不静默跳过；保持 `SPACE-PROVENANCE.json` 中来源与配方哈希可追踪。
- 保留许可和 notices。锁文件审计不覆盖全部上游预编译 bundle；不要把 `npm audit` 通过描述为全面安全审计。
- 构建拒绝覆盖已有同名产物。需要重建时先保留旧产物；正式新版本升版，已发布版本不能覆盖。不要自动替换用户正在加载的目录。
- 网页总结不能覆盖草稿或附件；异步提取/解析需在页面或会话切换后失效，避免把资料发送到错误上下文。
- 附件须明确展示解析、错误和截断状态。删除或取消后，迟到的解析结果不能重新附加；防止重复点击导致重复发送。
- 页面和文档内容视为不可信参考资料，不能当作系统指令；展示时安全渲染，折叠展示不能破坏复制、重试和历史中的原始内容。
- 当前 PDF 为文字提取，不含 OCR。OCR、按模型 token 预算、长文分段总结和检索问答尚未实现；字符/文件大小上限不能等同于模型上下文保证。后续实现必须显式处理这些边界，不能静默丢弃超限内容。

## 验证选择与证据

按改动范围选择验证，先定向再扩大；有失败就修复或明确报告，不能把跳过当通过。

| 改动范围 | 至少检查 |
| --- | --- |
| 更新事务、存储、身份 | `core`、`scoped-storage`、`update-identity` 单测；涉及流程时跑 `store` / `update` E2E |
| 发布 API、认证、包格式 | `server`、`package`、`large-package` 单测及 `publishing` E2E |
| SPACE AI 阅读与附件 | `reading-patch`、`attachments` 单测；重新构建包后跑 `reading-selection`、`reading`、`reading-upgrade` E2E |
| 桥接或完整扩展打包 | `browsa-bridge` 单测、完整构建及 `browsa` / 升级 E2E |
| UI 交互或样式 | 相关浏览器流程，窄窗口和错误状态；有视觉变化时检查截图 |

定向命令示例：`npx vitest run tests/attachments.test.ts`、`npx playwright test tests/e2e/reading.spec.ts`。涉及类型或构建时运行 `npm run check` / `npm run build`；涉及依赖或打包时审计依赖。

- SPACE AI 浏览器用例需要实际构建产物，有些用例缺包会跳过；升级测试还需要旧版包。先检查测试里的版本与路径，确保验证的是本次源码构建的包，而不是残留旧产物。
- 测试使用隔离浏览器、临时目录/数据库、假密钥和本地模型模拟服务。不要使用日常浏览器资料、真实 API Key 或公司文档作为 fixture。
- OPFS 测试证明浏览器文件系统逻辑，不能替代原生目录选择器验收；模拟模型响应不能证明真实外部服务兼容性。
- 不把 macOS Chromium 的结果写成 Windows Edge 已实测。测试数量与包哈希必须来自本次实际输出，不复制旧记录。
- 必要时更新 `docs/verification.md`，记录命令、结果、产物身份及未验证边界。

## 交付与 Git

- 不记录或提交密钥、密码、会话、SQLite、`.data/`、用户文档及浏览器资料。不要为调试输出整个配置或请求认证头。
- 审阅 `git diff` 和 `git diff --check`。禁止擅自 reset、clean、强推或撤销用户改动。
- 用户要求提交/推送时才执行相应 Git 操作；“实现功能”不自动等于上传生产包、审批发布或部署。已有明确授权不重复询问。
- 最终说明实现结果、关键文件、实际验证命令与结果、剩余限制。有安装包则给出实际路径和升级方式；明确是否已提交/推送，不把本地完成描述为上线。
