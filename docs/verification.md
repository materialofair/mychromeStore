# 验证记录

## 2026-09-25 发布中心阶段验证（历史记录）

- `npm run build`：包含 publish.html 的多页生产构建与 TypeScript 检查通过。
- `npm test`：58/58 通过（原核心 23、ZIP 校验 22、账号与发布 API 13）。
- `npm audit --audit-level=moderate`：0 vulnerabilities。
- `CHROMIUM_PATH=<测试浏览器> npm run test:e2e`：5/5 通过，包含原 Demo 真扩展重载/便签保留和新的真实后端发布流程。
- 发布中心浏览器流程：管理员创建开发者/审核员 → 开发者上传 → 访客不可见 → 审核员批准 → 访客下载 → 新版待审不影响旧版 → 管理员下架后直链 404。桌面和 390px 手机布局无横向溢出，页面无未处理脚本错误。
- API 覆盖：角色与扩展归属、自审禁止、CSRF、版本不可变/乱序审批、禁用与会话撤销、上传途中撤权、过期会话、最后管理员、配额、重启持久化、待审/驳回/下架直链保护。
- ZIP 覆盖：路径穿越/保留名、大小写和目录冲突、CRC、中央/本地头差异、软链接、伪造解压大小、数量及大小上限、Manifest 与公钥、代码文件引用和权限差异。
- 反代限流：默认拒信转发头；显式信任回环代理后才接受单个合法 X-Real-IP，验证独立客户端限流及无效头回退。
- 交互式管理员初始化在临时数据库通过，终端输出不包含输入的密码，临时测试数据已清理。
- 架构和代码/安全审查通过。修复了 Windows npm.cmd 启动方式及代理下共享登录限流桶的问题；Windows/Edge 实机和线上 Nginx TLS 尚未实测。
- 后端适用单机运行；新上传扩展的网页原目录自动更新尚未接入，发布中心提供审核下载。详见 [发布指南](publishing.md)。

## 2026-09-24 Demo 初始版本历史记录

2026-09-24，本次实现范围：自建静态网站 + 自有 MV3 Demo；无需管理员权限的本地解压目录更新。

## 环境和结论

- macOS，Node v25.9.0，npm 11.12.1。
- Google Chrome for Testing / Chromium **148.0.7778.96**，独立临时资料目录。
- 本地真实目录授权、网站更新、自动重载、便签保留与恢复均已通过。
- 未安装 Edge，因此没有宣称 Windows Edge 已通过；公司具体策略也不在本机验证范围内。

## 执行命令与结果

| 命令 | 结果 |
|---|---|
| `npm run check` | TypeScript 类型检查通过 |
| `npm run build` | 版本产物生成、类型检查、Vite 生产构建通过 |
| `npm test` | 23/23 通过 |
| `npm audit --audit-level=moderate` | 0 vulnerabilities |
| `CHROMIUM_PATH=<本机测试浏览器> npm run test:e2e` | 4/4 通过（约 20.5 秒） |
| `CHROMIUM_PATH=<本机测试浏览器> node scripts/manual-browser-proof.mjs` | 完整原生目录流程通过；系统选目录/授权由 CUA 操作 |

`CHROMIUM_PATH` 只是选取本机已有的官方测试浏览器；正常使用可执行 `npx playwright install chromium` 后运行测试。

## 动态 QA 场景矩阵

| ID | 用户/异常模型 | 场景与执行入口 | 预期 | 实际结果 / 证据 | 清理 |
|---|---|---|---|---|---|
| N01 | 正常员工 | 原生选择框授权临时外部目录，网站点击更新 | 磁盘和运行版本 1.0→1.1 | native harness 输出 PASS | 测试浏览器和临时目录已清理 |
| N02 | 正常员工 | 更新前填写便签，更新后重开扩展 | 内容仍在；1.1 显示纸张功能 | native harness + real installed e2e PASS | 独立测试资料已清理 |
| N03 | 正常员工 | 刷新网站，再点击恢复 | 目录句柄/备份持久化，运行版本回到 1.0 | native harness 三条 PASS 输出 | 已清理 |
| A01 | 损坏或恶意更新清单 | 路径穿越、Windows 保留名、原型字段、重复/大小写冲突、损坏 hash、超限 | 写入前拒绝 | core.test.ts PASS | 内存 fixture |
| A02 | 选错目录/自行改源码 | manifest 不匹配，受管文件被修改，新路径与用户文件冲突 | 零次写入，保护本地文件 | core.test.ts PASS | 内存 fixture |
| A03 | 磁盘/存储异常 | 备份提交失败、中途写失败、恢复失败 | 不写入或恢复旧版本；无法恢复保留 pending | core.test.ts PASS | 内存 fixture |
| A04 | 中断/刷新 | 浏览器持久化 pending 后刷新网站 | 恢复提示、禁止新更新 | recovery e2e PASS | 浏览器资料自动清理 |
| A05 | 两个标签同时操作 | 第二页获取更新锁 | 拒绝并显示忙碌 | recovery e2e PASS | 释放锁、关闭测试浏览器 |
| A06 | 用户取消授权选择 | showDirectoryPicker 拒绝 AbortError | 明确取消，无假成功 | navigation e2e PASS；此取消场景模拟 API | 浏览器资料自动清理 |
| A07 | 选中目录副本 | 浏览器加载 A，网站更新 OPFS 副本 B，同 key/ID | 运行仍为 1.0，reloadAndVerify 返回 false | real installed e2e PASS | OPFS 在临时资料中 |
| A08 | 非可信网页 | 同主机不同端口发送 RELOAD；错误 scope | 无接受响应、不触发重载 | real installed e2e PASS | 临时 HTTP 服务关闭所有连接 |
| A09 | 窄屏/导航/下载 | 390px 页面、导航按钮、实际 ZIP 下载 | 无横向溢出，下载正确包 | navigation e2e PASS | 截图保留，下载自动清理 |
| A10 | 用户更新后又修改文件 | 对 applied 备份执行恢复 | 拒绝覆盖后续修改 | core.test.ts PASS | 内存 fixture |

自动 filesystem e2e 使用浏览器 OPFS 测试真实 FileSystemDirectoryHandle、IndexedDB 和文件写入；它不能单独证明外部目录授权。N01–N03 使用**真正的原生文件夹选择器与外部临时目录**补足该证据。real installed 自动测试中的实际扩展目录复制使用 Node 完成，单独验证通信和运行时重载；不把该复制步骤当成网页 FSA 测试。

没有 LLM 输入执行功能，因此提示注入场景不适用；界面把目录名/服务错误作为转义文本渲染。研究文档保留了实现前的方案背景。

## 发现与修复

- 代码审查发现保留文件名可影响普通对象字典：拒绝原型保留名并使用空原型字典，补充测试。
- 便签初始化读取期间可能覆盖输入：读取完成前禁用输入和主题操作，失败时保持禁用。
- RELOAD 回应通道可能先断开：不以回应失败直接判断更新失败，继续限时检查运行版本。
- 首轮测试资料的开发者模式没有开启：测试改为通过扩展管理页面显式开启，符合产品已有前提；未变更用户主浏览器配置。
- 扩展重载会关闭弹窗页：测试重开弹窗再检查笔记，避免把正常行为误报为产品失败。
- 未可信端口测试 HTTP 服务的 keep-alive 曾拖延关闭：结束时关闭测试连接，避免悬挂。
- 视觉检查发现装饰便签文字对比不足：修复纸张层叠和文字颜色，再跑响应式检查。

## 独立审查与收尾

- code-reviewer：修复后的结论 APPROVE，23 项单元测试与类型检查通过。
- architect：结论 CLEAR，要求保留「macOS Chromium 已验证、Windows Edge 待验证」边界。
- cleanup：仅整理本次新文件，删除一次性探针，去掉重复 CSS 导入，格式化源码。保留必要的手动重载和恢复失败提示，没有掩盖错误。
- 验证使用隔离浏览器和临时目录，避免修改日常浏览器资料。

## 剩余限制

网站无法证明所选目录就是浏览器实际加载的那个副本；只报告观察到的文件/运行版本。更新是可恢复的多文件写入，不是原子替换；浏览器数据被清理后备份不保证存在。当前为单 Demo MVP，没有账号、上传后台或公共部署。固定 manifest 公钥用于稳定 ID，并不为自托管网页发布提供独立签名信任。
## SPACE AI / browsa 集成验收（2026-09-25）

- `npm run build`、`npm run check`：通过。新增独立 `update.html` 构建入口。
- `npm test`：74/74 通过，包括大 WASM、ZIP 上限、上传并发、桥接来源限制、按 ID 存储及备份身份校验。
- `CHROMIUM_PATH=<Chrome for Testing 148 路径> npm run test:e2e`：7/7 通过。
- browsa 完整包测试通过真实开发者上传、独立审批、待审不可下载、自定义模型设置 UI、真实 HTTP SSE 响应显示、扩展重载、配置与历史保留、完整包 OPFS 更新和恢复、跨端口拒绝。
- 通用页面测试通过两个扩展目录/备份隔离、备份 ZIP 下载、全部版本下架后的本地恢复及移动端布局。
- `npm run browsa:build`：每次运行模型相关上游测试 72/72；根依赖与配方锁定依赖审计均为 0 条已知漏洞。
- 最终产物 369 文件、10,277,664 字节。默认时区与 `TZ=UTC` 各构建一次，`cmp` 一致；SHA-256：`0d7b8956ae9468e39369e85eed5216adb508d997e2a2fc3a431232cb95c0b4c6`。

测试边界：browsa 的浏览器文件写入使用 OPFS，真实已加载扩展的文件替换/重载另行验证；没有把二者描述为 Windows Edge 原生目录选择器的端到端验收。视频、ASR、所有外部站点及远程 Agent 未逐一联调。保留的六个上游预编译 JS bundle 版本未知，按 commit 和文件哈希固定；npm audit 不覆盖它们，许可与来源见 `extensions/space-browsa/notices/`。


## SPACE AI 1.0.1 阅读体验验收（2026-09-25）

- `npm run build`、`npm run check`、`git diff --check`：通过。
- `npm test`：113/113 通过；`CHROMIUM_PATH=<Chrome for Testing 148 路径> npm run test:e2e`：11/11 通过。
- `npm run browsa:build`：上游模型测试 72/72 通过；`npm audit --audit-level=moderate` 与构建配方依赖审计均为 0 条已知漏洞。
- 真实加载最终扩展包，验证 TXT/Markdown/PDF 添加、删除、解析状态、草稿保护、实际模型请求内容、当前页面总结、资料折叠及历史恢复、键盘选区、窄窗口位置、编辑区排除与 Escape 取消。模型请求使用隔离的本地模拟 SSE 服务，不使用用户密钥。
- 真实 1.0.0 到 1.0.1 的目录覆盖与扩展重载测试保留模型配置和聊天记录；平台上传审批、更新与恢复回归通过。代码及最终展示增量独立复审均 APPROVE。
- 平台 `parsePackage` 校验最终 ZIP 通过：版本 1.0.1，固定 ID `jjehpfemjinjjbffcccknjlafkcknpep`，372 文件，10,289,179 字节，SHA-256 `d0de3bc00248359f4d2b45687b35467507b65d6ad1004e3f36a8a4e6233c56de`。
- 已复制到 `/Users/WangQiao/Downloads/SPACE-AI-1.0.1` 及同名 ZIP，核对哈希；未覆盖用户原 1.0.0 目录。

边界：本轮验证 macOS Chrome，Windows Edge 未实机验证。PDF 不含 OCR；文本类附件最多 5 个、单个 10 MiB、合计 100,000 字符，PDF 最多 100 页。远程模型服务及所有网站未逐一测试；上游预编译 bundle 的审计限制仍适用。
