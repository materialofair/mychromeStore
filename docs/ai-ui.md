# SPACE AI 1.0.8：扩展侧栏、交互工具卡片与实现文档

交付日期：2026-10-14。按用户确认方案完成1.0.8本地构建；没有替换用户正在加载的目录，没有上传、审批或部署安装包。源码提交状态以Git历史为准；1.0.7阶段此前已提交到GitHub。

## 实现与代码入口

- `extensions/space-browsa/ai-ui/panel.js`：纯文本工具标题、版本、保存/错误分别显示；常用操作、更多菜单、内联重置确认、摘要与折叠JSON审阅。菜单支持键盘、外部点击及进入iframe时关闭；重置成功/失败后恢复可见控件焦点。收起后也能重置，最终保存失败不会继续清空状态。
- 新增`ai-ui/panel.css`与`ai-ui/sidebar.css`，通过`ai-ui-patch.mjs`严格锚点接入：SPACE AI品牌、独立模型行、局部快捷栏/输入框、深浅主题、窄窗口。活动工具解除聊天气泡懒渲染限制，放大继续使用原iframe，避免消息包含块裁切。
- `ai-ui/tool-prompt.mjs`加强图表轴范围、单位、ResizeObserver/DPR、有限JSON和窄屏指导；入口改为“交互工具”，保留草稿并避免重复追加。旧图表内部代码没有被改写，未添加统一图表SDK或开放CDN。
- 新增[浏览器扩展实现指南](space-ai-extension-implementation-guide.md)、[完整架构与图表方案](space-ai-interactive-ui-architecture.md)、[UI方案](plans/space-ai-ui-optimization.md)和[独立预览](design/space-ai-ui-preview.html)。技术指南覆盖MV3、侧栏、sandbox、srcdoc、受限消息、后台存储与真实代码接入；预览不连接模型或真实聊天。

## 实际验证

先在原1.0.7包运行新增UI验收，标题和摘要缺失导致失败；之后在最终1.0.8包运行下列检查：

```sh
npm run check
npm test
npm audit --audit-level=moderate
npm run browsa:build
CHROMIUM_PATH='<本机Chromium路径>' npx playwright test \
  tests/e2e/ai-tools-ui.spec.ts \
  tests/e2e/ai-tools-flow.spec.ts \
  tests/e2e/ai-tools-model.spec.ts \
  tests/e2e/ai-tools-thinking.spec.ts \
  tests/e2e/ai-tools.spec.ts \
  tests/e2e/ai-ui.spec.ts \
  tests/e2e/ai-ui-deepseek.spec.ts \
  tests/e2e/reading.spec.ts \
  tests/e2e/reading-selection.spec.ts
```

结果：类型检查通过；14文件160项Vitest通过；24项实际扩展浏览器验收通过（0跳过，56.0秒）；构建内72项上游回归通过。根依赖审计0漏洞；构建依赖保留4项既有KaTeX相关低危条目，无moderate/high条目；审计不覆盖全部预编译vendor。JS语法、文档代码片段、相对文件链接、diff与源码凭据模式检查通过。

| 验证 | 观察结果 |
| --- | --- |
| 新卡片 | 标题、菜单与确认重置；键盘Enter后焦点恢复，收起后重置可用 |
| 布局 | 多消息中放大卡片实际占面板视口，iframe实例不变；Escape与焦点恢复；360/420px深浅主题无页面级横向溢出 |
| 分享与失败 | 摘要先显示、JSON按需展开、取消可用；最终保存失败时保留原工具与确认焦点，不调用RESET；草稿、附件和上下文守卫继续通过 |
| 三类工具 | 回放原样DeepSeek计算器、动态图表、物理模拟，验证实际计算、Canvas变化、运行/暂停/单步、放大和持久恢复 |
| 升级 | 把真实1.0.7的临时加载目录更新到1.0.8，再通过既有桥接重载核对版本；模型配置、历史和确认状态保留 |
| 安全/阅读 | 原消息来源、隔离资源/导航、租约、脚本错误、默认思考、原始源码与阅读/附件回归保持通过 |

本次没有重新请求外部模型：真实模型兼容性的既有证据见下方1.0.7/1.0.6记录，当前运行验收使用原样fixture及本地SSE模型服务。旧正弦样例在振幅3时仍有固定轴范围裁切；本轮明确记录该图表内部限制，加强新生成指导，不能把Canvas交互通过当作该样例坐标策略已修复。统一图表组件、更多选区/缩放交互和物理精度需按任务单独验收。

截图与日志位于`.data/verification/ai-tools-1.0.8/`，包括三类工具放大截图、深浅主题窄屏、新卡片和结果审阅。独立预览的布局、交互和刷新保留演示状态另在`.data/verification/ui-design-20261014/`验证；它不替代上述实际扩展测试。

## 最终产物与升级

- 加载目录：`.data/packages/space-browsa-1.0.8/`
- ZIP：`.data/packages/space-browsa-1.0.8.zip`
- 固定扩展ID：`jjehpfemjinjjbffcccknjlafkcknpep`
- 389文件，ZIP 10,336,379字节。
- ZIP SHA256：`f2ef88cf1d4e7e6f92d8c255d45c01074525341f85dfbdc8660f54b539d4ba4f`
- 最终59项配方哈希逐项匹配，包内panel.js与当前源码字节一致。manifest key、permissions、host_permissions、sandbox及CSP与1.0.7一致；原1.0.7产物保留，同版中间构建移入`.data/previous-builds/`。

备份实际加载目录，再把新包文件更新到该目录，在扩展管理页重新加载并核对版本1.0.8；不要卸载或清空存储。首次安装可直接加载解压目录。macOS隔离Chromium143已实测；用户日常profile和Windows Edge尚未实测。构建/文件更新不等于用户浏览器已运行新版。

---

# SPACE AI 1.0.7：默认思考模式下源码展示修复

2026-10-14 用户实测1.0.6仍只显示源码。本次保留1.0.6原加载目录，修复包升为1.0.7。本记录为本地验收记录；源码提交状态以Git历史为准，未上传安装包或替换用户目录。

## 复现与修复

使用已授权临时凭据和默认思考设置，通过真实扩展聊天管线转发DeepSeek SSE，生成完整计算器。真实响应9,233字符，finish_reason=stop，思考部分约4,908字符，最终HTML4,017字符；原样fixture为tests/fixtures/tools/deepseek-thinking-calculator.md。1.0.6解析结果error（每条消息只支持一个AI UI），新解析结果ready：思考草稿也包含工具代码围栏，旧解析器误把它与最终回答一起计数。协议现只识别思考区外的最终工具，保留最终源码字面标签、嵌套/多行思考标签和未闭合草稿围栏；取消、截断策略不放宽。

真实回复进一步暴露聊天数学处理改变代码块内的$表达式：执行器能正确运行原始HTML，但源码节点与原文不相等，无法折叠。panel现在按最终工具声明定位正文代码块，使用textContent恢复原始源码后折叠，思考和blockquote引用示例排除。复制/历史原文保留，不用innerHTML执行源码。

另一次真实1.0.7默认思考SSE生成同类计算器，finish_reason=stop，思考6,494字符、正文4,704字符。诊断脚本初次假定固定select/button ID，实际模型返回运算按钮，导致自动化定位失败，未计为交互通过；随后把该次原样完整回复装入最终包，实际点击8×2得到16，源码折叠且逐字等于解析HTML。证据：.data/verification/thinking-diagnostic/final-default-result.json与final-default-calculator.png。一次10,000-token非流式默认思考请求finish_reason=length，只计截断样本；不把关闭思考的既有fixture当成本轮默认思考验证。

密钥只通过诊断进程内存/标准输入转发，浏览器使用假key。没有把密钥写进源码、fixture、浏览器profile或包；临时诊断浏览器、代理与profile已关闭/删除。一次初始REPL代理在思考阶段停顿，不计为成功；完整SSE证据来自独立诊断进程。

## 最终验证与交付

- npm run check、npm test、npm audit --audit-level=moderate、git diff --check：通过；14个单测文件160项通过，根审计0漏洞。
- npm run browsa:build：完成，72项上游回归通过；387文件，ZIP10,331,182字节，SHA256 `00574b553d37933dadf70cfabc2135d04a45e752a5a3420048056288a4168a3f`。
- 使用Chromium143与CHROMIUM_PATH，运行 `npx playwright test tests/e2e/ai-tools-thinking.spec.ts tests/e2e/ai-tools-flow.spec.ts tests/e2e/ai-tools-model.spec.ts tests/e2e/ai-tools.spec.ts tests/e2e/ai-ui.spec.ts tests/e2e/ai-ui-deepseek.spec.ts tests/e2e/reading.spec.ts tests/e2e/reading-selection.spec.ts`：20项全部通过、0跳过（40.7秒）。包括真实默认思考完整回复、思考草稿完整/未闭合、引用原样、四则计算、源码折叠、确认保存后刷新恢复，三类原生工具的放大/重开/归档/浏览器重启以及结果发送和修订。
- 独立源码复核通过：思考围栏字面标签、最终源码恢复、blockquote引用保留及只折叠一次均验证；最终配方全部哈希一致。
- 修改：extensions/space-browsa/ai-ui/protocol.mjs、panel.js、upstream.json、README.md；tests/ai-ui.test.ts、tests/e2e/ai-tools-thinking.spec.ts、新默认思考fixture与本文档。本次未更换依赖。

安装包 `.data/packages/space-browsa-1.0.7.zip`，可加载目录 `.data/packages/space-browsa-1.0.7/`。旧1.0.6原位置不变；1.0.7中间测试包保存在.data/previous-builds。

备份实际加载目录，将新包文件更新到原目录后，在扩展管理页重新加载并核对1.0.7；不要卸载，以保留模型配置和历史。完整有效的旧回复可在重开会话时重新预览。模型截断/残缺代码仍须重新生成，不执行残缺程序。macOS隔离Chromium已测；用户日常浏览器、Windows Edge、截图原始星系回复未实测。保留4项既有KaTeX低危依赖条目；根审计0漏洞。更多原生工具边界见以下1.0.6实现记录。

---

以下为1.0.6阶段及更早记录；默认思考遗漏已由本轮修复。

# SPACE AI 1.0.6：完整 HTML/CSS/JS 工具与验收

交付日期：2026-10-14。按已批准方案实施；旧1.0.5和各次中间构建保留，未提交、推送、上传、审批或部署。没有替换用户正在加载的目录。

## 已实现

- 模型生成完整HTML/style/script，原生JS自行定义计算、Canvas/SVG绘图、事件和模拟。工具代码在manifest sandbox宿主中的独立opaque srcdoc子frame运行；宿主与工具不共享DOM/全局。普通HTML示例保持代码，显式space-ui或含SDK声明的html工具进入预览；未完成、取消、截断及重复块不启动。
- 源码默认折叠，复制/重试/历史保留原文。历史同步阶段先折叠工具源码，避免几百行代码阻止工具进入浏览器可见范围。实际工具frame免除上游气泡懒绘制；放大通过同一iframe改变布局，不复制或重新执行实例。
- `spaceTool.loadState/saveState/setResult/onPause` 保存应用数据、表单和结果。后台通过稳定消息UUID、源码SHA256、租约、共享历史写锁及schema1绑定数据；不同工具不串状态，迟到保存被拒绝。保存确认、容量错误和脚本错误可见；成功保存不会覆盖未清除的运行错误。
- 收起前暂停并等待最后快照确认；重新打开、侧栏刷新、浏览器重启及归档恢复后重建源码并恢复数据，模拟默认暂停。加载有并发守卫，重复点击只创建一个受控frame；重启可从失去响应的frame恢复最近已保存状态。
- 用户点“把结果发给AI”查看结果，再选择解释/修改并确认发送。原草稿和附件合并进入既有模型管线；重复发送、PREPARE后切上下文、发送阶段异步tabs.get后切上下文均有守卫。未提交不会误报成功。
- 修改版有父消息元数据及可见版本标签、“查看原版”；每次新回复有独立不可变消息身份/源哈希，旧工具及旧状态保留。启动失败的新版明确报错；不自动把旧状态强塞给不同源码的新版本。
- 旧声明式data-ui-action及application/space-ui+json格式继续由旧运行器处理，保留其既有功能。它们没有获得新SDK的完整状态保存及放大接口。

## 三类真实模型验证

使用用户已授权的临时凭据，直接调用DeepSeek Chat Completions、模型deepseek-flash。三类首次请求均HTTP200但finish_reason=length，不计为成功；要求紧凑完整代码后，三类均HTTP200、finish_reason=stop：计算器15,854字符、图表14,659字符、物理模拟12,893字符。完整回复原样保存在tests/fixtures/tools/deepseek-{calculator,graph,physics}.md，未手工改写生成代码；首次截断样本在.data/verification/ai-tools-initial保留。

真实调用使用non-streaming API；本轮共6次生成请求。临时key仅在联调进程内存使用，未写进源码、fixture、浏览器profile或安装包，结束后清除。原样生成回复在隔离macOS Chromium143.0.7499.4的**实际1.0.6扩展**中执行；结果发送与修订管线通过本地OpenAI SSE模拟服务验证，不把它声称为三次外部模型端到端SSE联调。

| 工具 | 实际验收 |
| --- | --- |
| 计算器 | 输入12和4，乘48、除3、减8、加16；原生按钮/JS、同实例放大、结果恢复 |
| 动态图表 | 振幅1改3，Canvas像素变化；运行/暂停/单步帧数变化，参数与帧数重开恢复 |
| 物理模拟 | 固定步长推进，小球Canvas画面变化；运行/停止/单步，重力1.6、位置/速度/时间/步数在重开后完整恢复 |

三类同时在聊天中操作，分别收起/重开，归档后清空当前会话再恢复，以及关闭浏览器重启同一临时profile均通过。420px窄窗口无横向溢出。截图等待内层viewport传播及绘制后采集，最终副本在.data/verification/ai-tools-1.0.6/{calculator,graph,physics}.png。

## 边界及实际保护

主扩展脚本CSP未增加inline/eval，permissions/host_permissions/key与1.0.5一致；从固定上游配方仅开放主frame-src self用于本地sandbox。sandbox额外允许inline脚本，原生工具子页CSP继续拒绝外部脚本/资源、fetch/XHR/WebSocket、Worker、表单导航、弹窗和顶层导航。测试的HTTP资源/CSS/SVG资源、fetch和子页面自身外部导航均未到达独立测试服务器；父页、扩展API、localStorage探测均被拒绝。该验收覆盖列明的浏览器路径，不是完整OS进程/网络安全审计。

可信宿主在转发前验证有限JSON，深度16、10,000节点、稠密数组最多5,000项、128KiB保存包及12,000字节结果；单个在途保存、每秒最多20次。后台快照128KiB、所有工具2MiB；SDK另有约60,000字符JSON预算。原生JS代码仍可能占用任意计算/渲染资源，这些数据限制不能当作CPU/GPU硬配额。

同步死循环实验使用独立临时profile、外部5秒进程终止保险：本次Chromium143中父页面仍响应，测试浏览器成功关闭，无需保险强杀。记录为.data/verification/ai-tools-1.0.6/blocking-boundary.json。停止控制能取消普通定时器/动画、调用协作式暂停；**不能保证中断任意同步JS执行栈，也不承诺所有浏览器都独立进程运行**。

状态恢复依赖工具接入SDK；任意闭包、JS堆、DOM监听和GPU资源不会自动序列化。意外崩溃恢复到最近确认快照。状态仅在当前或归档历史仍引用该消息时保留；删除全部引用后回收，不是永久备份。外部库/CDN、Worker及网络数据代理未开放；Windows Edge与用户日常profile未实测。

根依赖审计0漏洞，扩展保留4项既有KaTeX低危条目；无新增依赖。npm审计不覆盖全部固定上游预编译vendor，不能称为全面安全审计。

## 验证命令与记录

- `npm run check`、`npm test`：14个单测文件、158项通过。
- `npm run build`：类型与Vite网站构建通过；`npm run browsa:build`完整安装包构建通过，并通过72项上游本地模型回归。
- `npm audit --audit-level=moderate`、`git diff --check`通过。
- Chromium通过CHROMIUM_PATH指定：`/Users/WangQiao/Library/Caches/ms-playwright/chromium-1200/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`。
- 浏览器命令：`npx playwright test tests/e2e/ai-tools-flow.spec.ts tests/e2e/ai-tools-model.spec.ts tests/e2e/ai-tools.spec.ts tests/e2e/ai-ui.spec.ts tests/e2e/ai-ui-deepseek.spec.ts tests/e2e/reading.spec.ts tests/e2e/reading-selection.spec.ts`。此为1.0.6阶段记录，最终验收由上方1.0.7记录替代；此前失败用例均保留回归，不计为通过。
- 独立规格复核已通过；独立质量复核发现并修复重复重开及保存覆盖脚本错误，最新包两个定向浏览器用例2/2通过。旧包审查结果不冒充最终包实测。

## 修改范围与安装

本轮改动为extensions/space-browsa/ai-ui-patch.mjs、tool-state-patch.mjs、tool-revisions-patch.mjs、ai-ui/panel.js、legacy-panel.js、protocol.mjs、runtime.mjs、native-host.html、native-host.js、tool-state.mjs、tool-state-background.js、tool-prompt.mjs、upstream.json、README.md，scripts/build-browsa.mjs；新增tests/tool-state.test.ts、tool-runtime.test.ts、tests/e2e/ai-tools.spec.ts、ai-tools-model.spec.ts、ai-tools-flow.spec.ts、tests/fixtures/tools内三类手写及真实生成fixture，补充既有AI UI测试及本文档/已批准方案状态。既有锁文件、旧AI UI文件和其它用户修改保留，未混入Git提交。

安装包：.data/packages/space-browsa-1.0.6.zip；加载目录同名去掉.zip。387个文件，10,330,473字节；SHA-256：`248aa412c2511b80966904fb3bd33e07837903c51663f0ddfe8ee3a16b106ebd`。配方哈希和构建源码逐项一致，旧1.0.5包保留；中间1.0.6构建在.data/previous-builds下，仅以packages目录中的最终包为交付。

先结束聊天、收起工具确认已保存，备份实际加载目录；将1.0.6文件更新进**原目录**，在扩展管理页重新加载并核对版本。不卸载旧扩展，不重新生成manifest.key。首次用户仍需手动启用开发者模式加载解压目录；本站未自动上传或发布该版本。

---

以下为历史验收记录。

# SPACE AI 1.0.5：DeepSeek 真实生成与渲染修复

## 原因和修复

2026-10-13 用用户授权的临时 key 调用 `https://api.deepseek.com/chat/completions`、模型 `deepseek-flash`。第一次请求沿用 1.0.4 快捷按钮的原始约定，返回 HTTP 200 / finish_reason=stop / 8,094 字符，但使用 `html` 代码块。回复内有有效的 `application/space-ui+json` 数据程序，1.0.4 的解析器仅接受 `space-ui`，于是判定为 none，界面只显示源码。此前固定 `space-ui` 的模拟回复漏掉该格式。

1.0.5 接受两种明确 UI 契约：`space-ui`，或带 `script type="application/space-ui+json"` 声明的 `html` 代码块。普通 HTML 示例保持代码展示。完成后的有效回复和历史默认打开既有 sandbox，匹配的源码节点移到 details 中；装饰和复制按钮保留，原始 Markdown 仍用于历史、复制和重试。未完成、取消、截断、重复块或超限回复不进入预览。关闭/重开、重置、旧 frame 消息隔离保持原流程。

窄窗口真实回复还暴露了输入宽度溢出：332px iframe 内容宽度达到344px。在已有样式白名单内增加 flex 和 box-sizing，可信默认样式限制输入宽度及边框盒/最小宽度，避免 padding 和默认 margin 推出预览。没有新增依赖、任意 JavaScript 执行或 CSS 外部资源。

## 真实联调

共两次真实模型请求。第二次在隔离 macOS Chromium 141（缓存1194）中，通过**实际扩展聊天管线和真实 SSE**生成计算器；本机代理把请求转发给 DeepSeek，临时 key 仅在代理内存使用。浏览器 provider 使用假 key，未把真实 key 写入 chrome.storage、源码、fixture 或日志。请求只包含合成计算器需求和扩展提示，没有公司资料；限制为一次生成、max_tokens=4500、关闭思考。HTTP 200、finish_reason=stop、回复4,000字符。无需点击“打开”即出现预览；实际点击 8 和 2 的四则运算得到10、6、16、4，源码处于折叠状态。

两次模型回复原样保存为不含 key 的回归 fixture：`tests/fixtures/ai-ui-deepseek-calculator.md`（html）和 `ai-ui-deepseek-live.md`（space-ui）。联调代理及浏览器已关闭，临时 profile 删除，内存 key 清除。最终样式修复后重新构建的安装包使用同一真实回复回放验证；未为样式变更再次调用模型。

## 本轮最终验证

- `npm run check`、`npm run build`、`git diff --check` 通过。
- `npm test`：12个文件、140项通过。
- `npm run browsa:build`：最终1.0.5完整构建成功，72项上游本地模型回归通过。构建输出提示保留固定上游vendor，不能将其称为全部重编译或全面安全审计。
- `npm audit --audit-level=moderate`：根依赖0漏洞；扩展构建内审计保留4项既有低危。
- `CHROMIUM_PATH='/Users/WangQiao/Library/Caches/ms-playwright/chromium-1194/chrome-mac/Chromium.app/Contents/MacOS/Chromium' npx playwright test tests/e2e/ai-ui-deepseek.spec.ts tests/e2e/ai-ui.spec.ts tests/e2e/reading.spec.ts tests/e2e/reading-selection.spec.ts`：最终包8项通过、0跳过。
- 同一浏览器运行 `npx playwright test tests/e2e/ai-ui-deepseek.spec.ts --repeat-each=3`：两项各重复3次，6项通过。脚本显式等待iframe的布局帧后点击；初次自动化验收曾出现过早点击未改变结果的失败，最终验收使用上述等待，不把那些失败当作通过。
- 验证涵盖真实模型html格式、SSE未完成不打开、四则按钮、默认预览与源码折叠/展开、历史恢复、420px窄窗口无横向溢出、取消/截断不打开、恶意HTML消毒、断网/父页/API/弹窗边界、表单事件、递推/绘图/预算回滚、实例隔离和阅读回归。
- 最终截图：`test-results/ai-ui-deepseek-calculator.png`、`test-results/ai-ui-deepseek-narrow.png`，来自最终构建对真实回复的回放。截图等待输出完成绘制后采集，已确认像素显示10与DOM一致；稳定副本为 `.data/verification/ai-ui-1.0.5/deepseek-calculator.png`。测试结果目录会被下一次Playwright清理。

## 文件和安装包

本轮修改 `extensions/space-browsa/ai-ui/protocol.mjs`、`panel.js`、`sandbox.js`、`sandbox.html`、`upstream.json`、`README.md`；补充 `tests/ai-ui.test.ts`、`tests/e2e/ai-ui.spec.ts`、`tests/e2e/ai-ui-deepseek.spec.ts`、上述两份 fixture 及本文档。工作区原有构建脚本、锁文件及其他未提交修改保留，未提交或推送。

最终加载目录 `.data/packages/space-browsa-1.0.5/`，ZIP 同名，380文件、10,312,708字节；SHA-256 `09346e624e885bd6f38c52ddb68d6bba75ce10fd4d12dc641f4c369c5116aeeb`。全部配方哈希与当前源码一致；与1.0.4逐字段比较 key、permissions、host_permissions、sandbox 和 CSP 完全相同。旧1.0.4保留；首次1.0.5测试构建移入 `.data/previous-builds/ai-ui-1.0.5-before-layout/`，不要使用该测试构建。

更新实际加载的原目录后，在扩展管理页重新加载并核对1.0.5。不要卸载旧扩展；固定ID保留设置与聊天。没有替换用户正在加载的目录，也没有上传、审批或发布商店版本。Windows Edge、用户日常浏览器和其他模型/任意生成应用未实测；模型输出仍可能违反受限程序契约，不能执行任意原生JS。扩展依赖保留4项既有KaTeX低危审计条目，根依赖审计为0漏洞。

---

以下是历史1.0.4及1.0.3的实现/验收记录，不代表当前默认打开方式或本轮真实模型结果。

# SPACE AI 1.0.4 有界生成 UI

1.0.3说明与验证保留在下方，属于旧版记录。当前快捷栏AI UI附加新程序契约：用户正常发送，沿用当前provider、API风格、模型选择和SSE/历史管线。模型只要能输出文本即可，不依赖某家模型的专用UI接口。未检查日常profile的模型密钥或配置，未验证用户具体DeepSeek/GLM型号，也没有调用真实付费模型。

## 架构与选择

完成且未取消/截断的`space-ui`块 → 用户打开预览 → opaque-origin MV3 sandbox → 白名单HTML/CSS渲染 → 可信有界数据语言运行器。模型生成HTML、内联CSS和一个`<script type="application/space-ui+json">`JSON程序；该标签作为数据读取，绝不作为JS执行。运行器只有值与数学操作，不暴露宿主对象、动态属性路径、函数调用、网络、DOM或扩展API。源码没有计算器、图表、模拟的应用模板分支。

选择小型JSON数据语言，而非原生JS iframe、正则改写JS或Function遮蔽全局，也未引入复杂JavaScript解释器/Worker依赖。任意JS的死循环不能靠父窗口setTimeout可靠停止，opaque iframe不保证独立进程；Worker只能中断计算，也不能保证渲染/GPU资源。当前程序自身无无限循环语法，每次同步计算有确定步骤上限和50ms检查点；这不是浏览器线程的硬实时中断或进程内存配额。HTML解析、布局、字体和Canvas也受浏览器影响，有限数据预算不能保证完全不会卡顿。

Chrome官方[manifest sandbox](https://developer.chrome.com/docs/extensions/reference/manifest/sandbox)确认独立来源、无扩展API/父页面访问；[MV3商店政策](https://developer.chrome.com/docs/webstore/program-policies/policies#additional-requirements-for-manifest-v3)把远程复杂命令解释器也列为限制，并明确隔离于扩展API的sandbox/iframe例外仍须满足隐私和可审查功能要求。本运行器全部在sandbox，不在特权页执行模型逻辑。该依据不是商店批准保证；本次未发布。

## 可生成程序契约

单一程序对象字段为`version:1`、`state`、`views`、`events`，可选`tick`，不允许额外根字段。

- state最多64个键，值仅有限数值、字符串、布尔、null及数组，不支持宿主对象或任意属性访问。
- 表达式是基本值、`{"state":"键"}`、`{"input":"原始控件id"}`、`{"var":"变量"}`或前缀数组，例如`["+",2,["*",3,4]]`明确计算优先级。HTML id不加`ui-`，内部渲染会加前缀。
- 算术：`+ - * / % pow min max`二元；`abs round floor ceil sqrt sin cos exp log`一元；比较`== < > <= >=`；`not`；惰性条件`["if",条件,真值,假值]`；`num`显式转数值；`concat`连接简单值。
- 集合：`["array",值...]`、`["range",数量]`、`["map",数组,"变量",表达式]`、`["at",数组,索引]`、`len`、`sum`。不能通过字符串访问对象属性。
- views最多64个：`{"id":"result","text":表达式}`更新output/span/p/div/pre；`{"id":"chart","plot":表达式}`更新canvas，表达式返回[x,y]点数组。绘图为可信600×240 Canvas折线与范围标签，不允许模型绘图调用、外部库或SVG。
- events最多64个：`{"id":"button","event":"click","do":[命令...]}`，事件支持click/input/change/submit。命令支持`{"op":"set","key":"已有状态键","value":表达式}`、`{"op":"if","test":表达式,"then":[命令],"else":[命令]}`、`{"op":"repeat","count":表达式,"var":"i","do":[命令]}`。
- tick是模拟每步命令数组。默认暂停，用户点运行/停止/单步/重置，100ms一次，单次运行最多600步。状态按顺序更新，可实现递推、积分近似和条件控制；数值溢出、除零、错误输入及超预算均报错。

最小可计算示例（改变input后实时计算）：

````markdown
```space-ui
<section style="padding:16px;background-color:#e5f2eb">
<label>A <input id="a" type="number" value="2"></label>
<label>B <input id="b" type="number" value="3"></label>
<p>A + B × 4 = <output id="result"></output></p>
</section>
<script type="application/space-ui+json">
{"version":1,"state":{},"views":[{"id":"result","text":["+",["num",{"input":"a"}],["*",["num",{"input":"b"}],4]]}],"events":[]}
</script>
```
````

HTML仍兼容1.0.3 increment/toggle/form；有程序时使用程序事件，避免旧控制器重复执行。只新增canvas元素；内联style现在仅复制布局/色彩/文字的有限属性，拒绝URL、var/calc/expression及极长值，不支持style标签、滤镜、动画、任意CSS。模型原生script、onclick、外部链接、iframe、图片、meta和资源URL继续移除。

## 预算、协议与生命周期

每块64,000字符，HTML最多3,000节点/40层；程序最多6,000树节点/32层，值数组最多256项/8层，每个值最多4,096子项、字符串2,000字符、数值绝对值1e12，状态序列化32,000字符；事件事务最多12,000步骤并在运算检查点检查50ms；64个view、256绘图点、固定600×240 Canvas、100ms tick。计算事务失败回滚到最后成功state/输出，用户修复输入可重算，重置可重新开始。不会自动请求模型修复或付费重试。

桥接version=2，每次打开或重置都有随机instance和回填request；双方严格校验消息字段、source、版本、实例，父页面另校验null origin但不把null当认证。旧frame关闭/移除时清理消息监听及超时，sandbox pagehide停止tick，切会话销毁后无法回填；重开创建新实例，原始程序恢复、状态回到初始值、模拟保持暂停。聊天只持久化原始Markdown，不保存表单或执行状态副本。后续对话修改返回完整space-ui新版本，错误新版不替换旧消息可用版。

只有用户点扩展侧的「将显示结果放入草稿」才请求一次最多4,000字符的当前view摘要，仅包含text输出或图表点数，不自动导出state/表单。结果标注为不可信参考，放入草稿并在旁边显示，不自动发送；模型有意把输入写入text输出时，该显示值会随用户主动回填，所以用户应先检查显示内容。发送仍由用户控制。旧版无程序UI不导出表单。

主扩展CSP、permissions/host_permissions与1.0.3一致；sandbox继续script-src self，connect/img/font/frame/worker/object/form/base禁止，仅allow-scripts。模型没有原生JS，因此不能通过自身导航规避connect-src；没有开放popup/download/top-navigation/forms。此结论只覆盖本契约和浏览器正常执行边界，不是对任意原生JS的断网保证。

## 本次验收

Mac缓存Chromium 143、独立临时profile、本地OpenAI SSE fixture和假key；没有真实付费模型、日常profile安装、Comet操作、权限接受、提交、推送、PR或商店发布。首次Playwright默认缓存1208缺失，改用已存在1200，无新安装。

最终检查：`npm run check`、`npm run build`、12个Vitest文件/139项、上游72项本地模型回归、2项实际扩展AI UI E2E均通过。AI UI E2E覆盖流式未完成、取消、截断、历史恢复、旧表单与DOM clobbering、恶意HTML/脚本、网络/父页/扩展API/弹窗边界、重开、实例隔离，以及优先级14→22计算、滑块改图、递推参数、停止/单步/重置、超预算回滚、显示结果仅主动回填草稿、对话修订7与错误新版本保留旧版、错误输入恢复。截图见`test-results/ai-ui-program.png`和`ai-ui-narrow.png`（本地生成文件）。

根依赖审计0漏洞；扩展保留4项既有低危KaTeX依赖警告，无新增依赖。验证1.0.3与1.0.4的permissions/host_permissions/CSP/sandbox/key完全相同，未扩大权限。SPACE-PROVENANCE全部配方哈希与源码逐项匹配；旧1.0.3产物未覆盖。

最终包：`.data/packages/space-browsa-1.0.4/`及同名ZIP，380文件，10,311,837字节；ZIP SHA-256 `7b9aaf0cf7c0ca81d3229afff9bec535323a704435e4bce8772cd8b48ba22b4a`。首次1.0.4测试包另存`.data/previous-builds/ai-ui-1.0.4-first/`，勿将首次测试包当最终包。没有自动替换任何浏览器加载目录；安装/更新仍由用户按已有流程选择最终包。


# 历史：SPACE AI 1.0.3 交互 HTML

侧栏输入草稿后点击快捷栏 **AI UI**，会附加输出约定（不会自动发送或覆盖草稿）。发送后，模型必须明确返回一个 `space-ui` Markdown 代码块；普通文本和 `html` 代码块仍按原方式显示。完整回复到达后，消息提供「打开交互预览」，关闭并重开会重置本地状态。

示例提示词：

> 做一个本地计数器，用一个 space-ui 代码块返回 HTML。用 output id="count" 显示数字，用 button type="button" data-ui-action="increment" data-ui-target="count" 增加数字。不要使用 script、事件属性、链接或外部资源。

示例输出：

````markdown
这是你的计数器：
```space-ui
<section style="padding:16px;background:#e5f2eb;border-radius:12px">
  <h2>阅读计数器</h2>
  <output id="count">0</output>
  <button type="button" data-ui-action="increment" data-ui-target="count">加一</button>
  <button type="button" data-ui-action="toggle" data-ui-target="notes">展开笔记</button>
  <div id="notes">只在当前预览内交互。</div>
  <form>
    <input name="task" placeholder="下一项任务">
    <button type="submit">本地回显</button>
    <output></output>
  </form>
</section>
```
````

支持布局、内联样式、文本、表格、details/summary、输入控件，以及有限的可信本地交互：`increment`、`toggle`、表单字段回显（点击提交按钮或输入框回车）。任意模型 JavaScript、onclick 等事件属性和外部资源都会移除。复杂图表、任意脚本应用与外部库不属于此首版契约；模型可能不遵守约定，需要明确要求重新生成。

## 隔离边界

- 新增 manifest sandbox 页面，唯一不透明来源，没有 allow-same-origin；iframe 只允许可信打包脚本。
- 扩展脚本 CSP 保持原值，仅将 frame-src 从 none 改为 self，使扩展能嵌入本地 sandbox。没有新增 permissions、host_permissions 或 web_accessible_resources。
- sandbox CSP 的 default/connect/img/font/frame/worker/object 均禁止，form-action 和 base-uri 禁止；无 popup、download、top-navigation、allow-forms。
- 生成内容仅在 sandbox 内通过 DOMParser 解析，并复制白名单元素和属性。script、事件属性、导航与资源 URL、iframe、meta、SVG 等不复制；内联样式不能突破父页面边界，网络受 CSP 限制。
- 消息桥仅有 HELLO/READY/RENDER；验证 frame source、READY 不透明 origin 和严格字段集合，不接收 UI 事件或扩展操作请求。sandbox 只接受父窗口的定长 HTML，一次渲染。
- 每条消息一个块，上限 64,000 JS 字符、3,000 节点、40 层嵌套；空、重复、过大、不完整内容有重新生成提示。流式期间只显示安全代码/接收状态，不运行预览；取消保存的 interrupted 历史不提供预览。
- 原始 Markdown 沿用现有聊天历史持久化，不增加 HTML 存储副本。本地控件状态不保存，不发送到模型。切会话会销毁旧 iframe；重新打开从原始 HTML 开始。

Chrome 规范依据：[sandbox](https://developer.chrome.com/docs/extensions/reference/manifest/sandbox)、[CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)。

## 本次验证

使用 Mac 隔离 Chromium 143（缓存 chromium-1200）与本地模拟 OpenAI SSE；没有使用真实模型、API Key、日常 profile 或 Comet。

- `npm run check`、`npm test`、`npm run build`。
- `npm run browsa:build`：配方应用、依赖审计与上游72项模型测试。
- `tests/ai-ui.test.ts`：协议、未完成/取消、尺寸、重复块及策略约束。
- `tests/e2e/ai-ui.spec.ts`：真实扩展、未完成流不创建iframe、完成后预览、按钮/表单、脚本/导航资源移除、父页面/API隔离、关闭重开和历史重开。

构建时原锁文件的 source-map-js 高危与 markdown-it 中危阻止审计，已仅更新传递依赖至 1.2.2/14.3.2。根项目审计零漏洞；扩展审计仍有4项低危 KaTeX相关条目，保留现有版本，未降低审计门槛。上游预编译 vendor 并非全部被 npm 审计覆盖。

安装包位于 `.data/packages/space-browsa-1.0.3/` 及同名 ZIP。没有安装到日常浏览器、提交、推送或发布商店。首次手动加载仍由用户选择；保留固定扩展身份与现有模型设置。真实外部模型兼容性与用户浏览器手动安装尚未验证。

最终结果（2026-10-13）：根项目11个测试文件/135项全通过；类型检查、网站构建与diff空白检查通过；扩展模型测试72项通过。最终1.0.3产物的AI UI浏览器用例和完整阅读用例通过，选区/折叠资料两个用例补齐原始fixture后通过。AI UI用例还曾连续重复3次通过。旧的`browsa.spec.ts`可选发布/升级用例硬编码缺失的1.0.0包而跳过，不计为通过；真实模型与人工安装不在此fixture验收范围。

最终ZIP SHA-256：`d04401663f506ef5a5c8e8ab405a6150d73dbe23488bad94f0936420bfa22323`，大小10,305,372字节，379个文件。已核对产物`SPACE-PROVENANCE.json`中所有配方哈希与最终源码一致。没有独立lint脚本；类型、语法与diff检查已执行。

## 精确交互契约和适用范围

首版是受限HTML UI预览，不是通用JavaScript应用运行器。它覆盖信息卡片、静态表格、计数、折叠和表单回显；不足以覆盖任意交互HTML，例如计算器业务逻辑、拖拽、图表联动、复杂校验、异步查询、自定义事件处理。后续能力需由可信控制器明确实现，不能给模型脚本扩展权限。

| 字段或组件 | 实际语义 |
| --- | --- |
| `space-ui`代码块 | 每条消息一个；普通`html`块不激活 |
| `id` | 格式`^[a-zA-Z][\w-]{0,63}$`，生成者应使用唯一id；预览内部加`ui-`前缀 |
| `button data-ui-action="increment" data-ui-target="原始id"` | 目标文本转数字后加一；非数字从1开始，上限1e9 |
| `button data-ui-action="toggle" data-ui-target="原始id"` | 切换同一预览内目标的hidden状态 |
| `form`、命名输入控件、`output` | button/input submit点击或输入框回车，将FormData本地回显到form内第一个output；不发送、不导航、不存储 |
| `type="button"` | 声明式increment/toggle优先执行；form内省略type也正常；明确type=button仍可使用 |
| `details/summary` | 浏览器原生展开/收起 |
| `style` | 支持内联CSS，单属性最多1000字符；不支持style标签、外部CSS，资源URL受CSP阻断 |

允许HTML元素：`div span p h1 h2 h3 h4 ul ol li strong em b i br hr section article header footer main label input button select option textarea form output details summary table thead tbody tr th td pre code`。

允许属性：`class style title aria-label placeholder type value min max step name rows cols selected checked disabled hidden data-ui-action data-ui-target`，每个属性值最多1000字符；id另行验证。type只允许`button submit text number checkbox radio range email`。label请包裹input，`for`不在白名单。未知标签连同子树移除，未知属性移除，未知action不执行。

不支持任意script、事件属性、链接、图片/音视频、SVG、iframe、外部库、fetch/WebSocket/Worker、弹窗、下载、顶层导航或任何父页面/扩展API访问。过大、过深、节点过多、消毒后无可显示内容有可恢复提示。表单命名控件可能遮蔽DOM方法，可信控制器使用Element原型方法处理该边界。

72项上游测试是固定源码本地回归，**不是72次真实模型联调**；本次聊天仅用本地OpenAI SSE fixture及假key。未触碰Comet或日常profile。

独立复核P2已修复：chat-handler持久化outputTruncated，实时DONE与历史升级都通过同一isUiBlocked判断，interrupted或outputTruncated均无预览。真实fixture以一个完整闭合UI块加截断解释返回两次finish_reason=length，验证自动续写仍截断后实时和重开历史一致。未指定type的form内increment/toggle优先执行声明式动作；button submit、input submit点击及输入框回车均只本地回显。旧历史若未保存截断标记，无法可靠追溯当时是否截断；不会猜测或修改旧记录。
