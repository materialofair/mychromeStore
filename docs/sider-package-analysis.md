# Sider CRX 静态分析（2026-09-25）

## 获取与校验

从 Google 官方 update2 CRX 分发端点取得扩展 `difoiogjjojoaoomphldepapgpbgkhkb` 的 CRX3 安装包，Manifest 版本为 **5.33.0**。

- 原包 30,168,562 字节（28.77 MiB）；解压后 96,147,613 字节（91.69 MiB）。
- ZIP 有 382 个条目，实际文件 314 个。
- SHA-256：`ce8c1d88ff25f902808ded3d0e239c4dadc898cc388170fd36f8003457ea5514`。
- 使用 CRX3 signed-header 与完整 ZIP 数据验证签名；3 个 proof 均通过，至少一个签名公钥哈希与请求的扩展 ID 匹配。
- 仅静态读取文件，未安装或执行扩展，未调用其聊天服务，也未提供任何用户 API Key。
- 包和解包产物位于 Git 忽略的 `.data/research/sider/`，不进入网站公开目录和 MIT 仓库。

## 核心发现：已有自定义接口与模型配置

在 `options.js` 中定位到供应商编辑界面与配置保存逻辑；在 `background.js` 中定位到读取该配置并构造聊天请求的逻辑。

| 能力 | 静态证据 | 判断 |
|---|---|---|
| 自定义 API Key | 设置对象中存在 apiKey，请求端读取对应供应商配置 | 已有实现 |
| 自定义 Base URL | apiBaseUrl 的输入保存处理与请求地址覆盖逻辑均存在 | 不是仅内置默认地址 |
| 自定义模型 | models、模型名称映射和可见性配置；请求时使用所选模型 | 已有模型配置能力 |
| OpenAI 兼容聊天 | 供应商默认 chatPath 为 /chat/completions，构造 messages 与 stream | 原需求大部分已有 |
| 模型列表 | 配置端调用供应商的 /models | 某些仅实现聊天端点的网关可能需手动添加模型；未做实机验证 |
| 多供应商 | 定义 OpenAI、DeepSeek、Groq、Google、Ollama、Anthropic、Azure 等适配 | 不是单一 API 写死的客户端 |

结论：**仅为了填写自己的 Base URL、模型和 API Key，可能无需修改安装包。** 以上是静态代码链路证据，尚未验证某个具体网关、账号状态下的 UI 可用性与端到端请求。

官方发布说明也描述了 `Options → General → AI Access → Custom API Key` 路径。当前 5.33.0 的界面名称与入口仍需实机核对，不应把静态发现等同于真实 API 联调通过。

## 扩展结构与维护成本

| 文件 | 体积（字节） | 主要职责线索 |
|---|---:|---|
| options.js | 2,030,658 | 设置、供应商与模型配置 |
| background.js | 2,413,509 | Service Worker、请求与业务调度 |
| sidepanel.js | 8,912,261 | 原生侧栏与聊天功能 |
| content-all.js | 9,372,811 | 页面内注入与交互 |
| standalone.js | 11,230,211 | 独立界面与大量打包依赖 |

Manifest 使用 MV3、原生 side_panel、options_ui，并配置了广泛的内容脚本与网站访问权限。包内另有文件预览、音视频、沙箱、agent 和翻译等模块。

未发现 source map、项目 package.json、TypeScript 工程、构建配置或项目级开源许可证。这是可读的压缩运行产物，不是可正常维护的原始工程。公共依赖代码与产品代码混合打包，不能由其中存在开源依赖推断整个产品开放源码。

能在压缩包中定位设置字段，并不意味着后续更新、构建、测试和去除服务耦合成本低。改动任一文件也会使原 CRX 的签名不再有效，不能继续声称它是官方原包。

## 后端依赖边界

包内可定位自定义模型直连供应商的请求分支，也存在 Sider 自有服务、账号相关代码、远程模型预设与事件上报端点。不能将所有功能都视为可脱离 Sider 后端运行。

本次未执行代码，未验证所有条件分支，也没有据此断言密钥是否会在任何其他路径上传。现有自定义请求逻辑只能证明存在对应能力，不能替代动态网络和隐私审计。

## 与 SPACE 平台的兼容性

当前包不能直接通过已有上传校验：

- 28.77 MiB 原包高于 4 MiB 上传上限；解压总大小 91.69 MiB 高于 8 MiB 限制。
- 314 个文件高于 100 文件限制；8 个文件超过 2 MiB 单文件上限。
- Manifest 名称为本地化占位符，当前平台要求直接名称。
- 解包后的 Manifest 没有平台要求的固定 key；CRX 身份在签名头中，不能简单套用另一个扩展的 key。
- 未声明本站需要的 externally_connectable，也未接入 SPACE PING/RELOAD 更新协议。

不能为了导入这个包就直接放宽整个平台的上传安全限制。即使调整大小限制，仍要处理身份、运行时通信、版本更新和重新分发许可。

## 成本判断与建议

1. **自己使用自定义模型：成本最低。** 先使用官方 Sider 的现有自定义 API 配置验证具体网关，可能不需要开发。
2. **修改官方包并长期维护私有版本：初始界面复用多，但升级、后台耦合、调试和再分发边界复杂。** 不能仅凭 CRX 可下载就将其复制进 MIT 项目。
3. **作为自建商店的 MIT 扩展：推荐独立实现所需功能。** 分析得到的功能结构和公开 API 协议可用于明确需求；实现侧栏聊天、手动网页/选区摘要、Base URL/模型/Key 配置以及 SPACE 通信，不搬运原产品代码或品牌资源。

这次分析实际减少的是需求探索成本：已经明确无需复刻完整 Sider，只需独立实现通用接口、侧栏体验与平台集成。尚未制作修改版，也未将第三方包发布到商店。

## 参考

- [官方 Chrome 商店页](https://chromewebstore.google.com/detail/sider-chat-with-all-ai-gp/difoiogjjojoaoomphldepapgpbgkhkb)
- [官方自定义 API 发布说明](https://sider.ai/es/whats-new/browser-extension/Sider-v4_42_0/)
- [Sider 使用条款](https://sider.ai/policies/terms)：所查页面说明产品代码权利归属及提取/复制限制，不构成将该产品作为 MIT 源码再分发的授权。
