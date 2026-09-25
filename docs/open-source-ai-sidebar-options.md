# 类 Sider 开源扩展选型

核查日期：2026-09-25。目标：与 Sider 接近的浏览器侧栏/页面 AI 工具，支持自定义 OpenAI 兼容接口，并能作为当前 MIT 平台的独立扩展接入。

## 结论

确定采用 **browsa** 作为后续适配基础。其中文侧栏、网页/PDF 阅读、视频时间戳、划词与自定义模型更符合目标功能。ChatGPTBox 和 Page Assist 保留为参考，不再作为主方案。项目规模小，因此采用前仍需验证、依赖修复及权限审查；不以近期推送时间代替维护质量判断。

## 对比

| 项目 | 许可证（已读取） | 相似点与已核查能力 | 主要取舍 |
|---|---|---|---|
| [ChatGPTBox](https://github.com/ChatGPTBox-dev/chatGPTBox) | MIT | 页面聊天、侧栏相关实现、划词翻译/润色/解释、网页与视频摘要、搜索引擎/站点适配、自定义 API 和模型 | 最适合复用接近 Sider 的常见页面交互；不等同于 Sider 全套 Agent/Code 功能 |
| [Page Assist](https://github.com/n4ze3m/page-assist) | MIT | 侧栏、网页问答、独立聊天页、OpenAI 兼容接口、本地模型、知识库/MCP 文档 | 更偏模型工作台，页面划词体验不应假定与 Sider 相同 |
| [browsa](https://github.com/xiaohuzai/browsa) | MIT | 中文侧栏、页面上下文、划词、视频时间戳、PDF、本地/自定义模型及 Agent 桥接 | 功能很接近，但采用前需要更充分的质量、依赖和权限检查 |
| [ChatHub](https://github.com/chathub-dev/chathub) | GPL-3.0 | 多模型聚合对话 | 重点是多模型对比；不能把其修改版简单改标成 MIT |
| [OpenBrowserAgent](https://github.com/Lumysia/OpenBrowserAgent) | AGPL-3.0 | 侧栏、模型配置、浏览器任务 | 更偏代理任务；不作为本项目纯 MIT 扩展的首选 |

GPL/AGPL 项目可以作为遵循各自许可证的独立扩展分发；这里不选择它们是产品方向与许可证管理的取舍，不是声称它们不能与 MIT 商店并存。

## 直接源码证据

已克隆前三个项目到 `.data/research/`，不影响当前平台代码。

- ChatGPTBox：提交 `6554b8ed9dd0968e8aaba723b32d8e05e3e16855`。
  - `LICENSE`：MIT，保留 josStorer 和 wong2 版权声明。
  - `src/services/apis/custom-api.mjs`：自定义请求接收 apiUrl、apiKey、modelName，并调用共用 OpenAI-compatible 实现。
  - `src/services/apis/openai-compatible-core.mjs`：实际请求适配模块。
  - `src/manifest.json`：Manifest V3，声明 sidePanel；background/menus 与 commands 有侧栏调用。
  - 有构建脚本、依赖锁定文件及 Node 测试入口，不是只有运行产物。
- Page Assist：提交 `cc6f3200b89f3c24a30f0335215eeb20adc6088e`。
  - `LICENCE`：MIT，版权归 Muhammed Nazeem。
  - `src/models/index.ts`：使用 providerInfo.apiKey 与 providerInfo.baseUrl 构造模型客户端。
  - WXT、React 工程，提供 Edge 构建命令；文档列出 OpenAI-compatible 接口、知识库和 MCP。
- browsa：提交 `7f6df4b8712a40214a358c34483982b7e774f4b8`。
  - `LICENSE`：MIT。
  - 提供源代码、构建/打包脚本、测试目录和中文使用指南；README 描述的高级提取能力本次尚未逐项运行验证。

GitHub API 本次返回最近推送时间分别为 2026-09-22、2026-09-20、2026-09-24，均未归档。这说明近期有提交，不代表每项功能都已稳定或安全审计通过。

## 接入当前平台的实际工作

选择 browsa 后，主要是适配而不是重新开发：

1. 固定上游提交，保留 MIT 许可证及版权，使用独立扩展名称和固定公钥，避免冒充官方版本。
2. 以 browsa 的 LLM Provider / OpenAI-compatible 为默认配置路线；核实网关地址、模型名、Key、流式返回和错误处理。
3. 构建 Edge/Chrome MV3 包并测量文件数和体积。当前平台的 4 MiB ZIP / 8 MiB 解压 / 100 文件限制是为小型 Demo 设计，不能未经测量就承诺直接上传；按真实需要优化包体或设计有界的大包处理。
4. 加入精确商店来源的 PING/RELOAD 协议；目录更新状态、备份和锁按扩展 ID 隔离，不能复用单 Demo 的固定备份槽。
5. 经过现有开发者上传、审核员批准、公开下载流程；不绕过审核默认上架。
6. 用隔离浏览器验证真实安装、自定义模型请求、版本升级和设置保留。

本次完成检索、许可证及部分源码核查；尚未安装候选项目依赖、构建、实际调用模型或完成平台接入。不存在已验证的“完整替代 Sider 全部功能”结论。


## browsa 首轮运行验证

- 固定源码版本 `0.35.10`，上游提交见前文。
- `npm ci --ignore-scripts --no-fund` 成功。
- `node --test --test-concurrency=1 test/llm-client-chat-reasoning.test.mjs test/llm-client-responses.test.mjs test/options-provider-ping.test.mjs test/lib-provider-multi-model.test.mjs`：72/72 通过。这些是上游测试，不代表已经连接用户的真实模型。
- `npm run package` 成功，ZIP 为 9,641,719 字节。此命令使用仓库已有 vendor 产物打包，不代表完整重建了每个第三方库。
- `npm audit --json`：4 项漏洞（DOMPurify 与 Mermaid 各中危、pdfjs-dist 与 undici 各高危），工具均报告有可用修复。需在适配分支升级、重新构建相关 vendor 并回归，不能只更新锁文件就宣称发布包已修复。
- 上游打包脚本会删除 manifest.key（为官方商店上传准备）。SPACE 版本必须使用独立、稳定的公钥和单独的打包步骤。
- 当前 ZIP 超过平台 4 MiB 限制；需要实际测量每文件/总展开大小，并保持有界解压和权限审核，不能直接取消限额。

本轮仅修改选型与验证记录；没有将上游包上传到公开目录，也没有修改用户已有账号、密钥或已安装扩展。
