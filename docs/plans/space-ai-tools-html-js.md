# SPACE AI 完整交互工具方案

日期：2026-10-13。状态：用户已批准，1.0.6已实施，验证见docs/ai-ui.md。目标版本：1.0.6；保留1.0.5及既有未提交修改。

## 目标与当前差距

AI 根据问题生成完整 HTML/CSS/JavaScript 工具；计算器、动态图表和物理模拟均由模型代码定义。在消息中直接操作、放大、收起；重开侧栏、历史和浏览器后恢复工具状态。用户主动点击“把结果发给 AI”后，沿当前对话解释结果或修改工具。

当前差距均已核对源码：

- `extensions/space-browsa/ai-ui/panel.js:71` 明确禁止JavaScript，并要求私有JSON运算语言；不符合本目标。
- `extensions/space-browsa/ai-ui/sandbox.js:58` 开始解析HTML，`:64` 按标签白名单复制，`:81` 运行JSON程序；改一句提示词不会让JS开始执行。
- `extensions/space-browsa/ai-ui/panel.js:29` 销毁frame，`:40` 重发原始HTML；没有工具快照保存，重开会重置。
- `extensions/space-browsa/ai-ui/panel.js:42` 的结果协议只在用户点击后回填草稿，`:47` 不发送；尚无继续解释/修改工具的对话流程。
- `extensions/space-browsa/ai-ui-patch.mjs:26` 的sandbox CSP只有script-src self，原生内联生成脚本不会运行。主扩展页面仍须保持自身严格CSP。
- 构建产物上游 `lib/storage.js` 的会话逻辑（435–455、478–490行）使用全局history及归档快照；`lib/handlers/chat-handler.js:126` 决定流式回复会话归属。工具不能直接用数组位置作为持久ID，更不能把临时tabId当作对话身份。改动要写入配方补丁，不改生成包或缓存。

## 选择

选择原生HTML/CSS/JS sandbox运行器。继续扩展JSON解释器会持续限制生成能力；把全部JS放进Worker并代理DOM，需要另造大量浏览器API兼容层，不作为首版。原生sandbox支持标准DOM事件、函数、Canvas/SVG、CSS和requestAnimationFrame；外部依赖需要打包的已知库，不让模型从任意CDN加载运行代码。

推荐分三层：

1. 可信扩展侧栏：拥有用户按钮、工具归属、保存存储与发送模型能力。
2. 独立来源的manifest sandbox宿主：运行打包控制器，验证内外消息，创建受限子frame。
3. 独立来源的工具子frame：运行生成HTML/CSS/JS和小型状态SDK；无法读取侧栏、扩展API、模型设置或其它工具的状态。

宿主与模型代码不共享全局对象。子frame以srcdoc承载完整页面，sandbox只允许scripts，不允许same-origin、popups、top-navigation或forms。宿主仅为sandbox增加必要的inline脚本许可，主扩展不增加unsafe-inline/unsafe-eval。第一步必须实测Chrome的嵌套sandbox、srcdoc CSP继承和资源加载行为，不能凭字符串配置宣布隔离完成。

Chrome官方明确允许sandbox使用自己的脚本CSP，且不提供扩展API或直接访问非sandbox页面：

- [Manifest sandbox](https://developer.chrome.com/docs/extensions/reference/manifest/sandbox)
- [Extension CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)

这是可行性依据，不是整个方案已验证或官方商店已批准的证明。

## 工具和状态契约

继续通过一个明确的space-ui代码块输出完整工具页面，但内部使用普通style和script，不再要求JSON运算语言。普通代码示例不自动运行；取消、截断、重复或未完成输出继续禁止启动。旧JSON程序作为legacy格式保留兼容。

模型只需要掌握小型生命周期接口，例如：

```js
const restored = await spaceTool.loadState();
// 根据 restored 或默认值初始化模型自定义应用。
spaceTool.saveState({ schemaVersion: 1, inputs, simulation, series });
spaceTool.setResult({ summary: '当前结果', data: result });
```

接口是提案，实施时固定名称、错误和返回值。应用逻辑仍为普通JS；状态仅为可序列化数据，不是另一套运算语言。

- 向工具提供的loadState仅包含本工具当前版本的状态。saveState自动在本地保存，不触发模型调用；setResult只更新待分享结果，不自动发送。
- 参数、计算结果、图表数据、模拟位置/速度/时间/随机种子等必须由生成代码保存；不能承诺任意JS堆、闭包、DOM监听或GPU资源能自动序列化。重新加载时重新执行源码并恢复数据及监听。
- 通用表单快照可补充输入恢复，但不能代替模拟/应用状态。未按生命周期保存的工具显示“尚未保存状态”，不假装恢复成功。
- 使用持久toolId与immutable revisionId，并记录sourceHash和stateSchemaVersion。用户修改生成新revision，默认不把旧状态强塞给不兼容的新代码；模型可以提供明确迁移。旧版保留且可回退。
- 在工具产生时保存稳定conversationId与messageId，贯穿当前history、归档、切会话和重开，不依赖history数组下标。旧消息按确定迁移规则分配ID；不以源码哈希将不同消息的状态合并。
- 可信后台串行保存，检查JSON大小/深度、归属及revision；合并高频保存、递增序列号并返回确认。关闭前请求快照，正常运行定期保存；意外崩溃只能恢复最近确认状态，UI显示保存状态与错误。
- 删除对话清理其工具；自动历史裁剪、归档淘汰和用户保留工具的关系要有确定规则。不能随意清空chrome.storage.local。

## 聊天展示与放大

回复完成后直接显示工具，源码折叠可查看/复制。外侧提供放大、收起、重新打开、重置、停止/重启和把结果发给AI；模型不能重写外侧控制按钮。

放大在同一frame上改变布局，避免重建frame或移动到另一文档造成重置。收起时保存并暂停模拟；恢复参数和模拟进度，重新打开默认暂停，用户继续运行。页面切换/销毁后从持久快照重建；放大缩小不产生第二套状态。

停止按钮可停止协作式定时器/动画；异常重启重新建立运行实例并恢复最近快照。原生JS死循环可能阻塞同线程的宿主，iframe不是可靠CPU配额或可强杀进程：不能宣称“任意代码50ms内必停”。首轮验证需测试阻塞行为；重计算优先放可终止Worker，Worker许可和资源边界单独验证。若目标要求恶意JS硬中断保证，需改用带中断的引擎/隔离进程，重新评估标准DOM兼容与部署约束。

## 把结果发给AI

用户点击扩展外侧按钮后，可信宿主从当前revision读取result，展示将发送的摘要、可选提问和数据范围；确认发送调用既有聊天管线一次。若现有草稿或附件存在，明确保留/合并，不覆盖或丢弃。双击去重，流式发送中禁用重复提交。

消息含工具标题、toolId/revision、用户问题、当前选中结果及需要的源码上下文。结果、源码和错误均作为不可信资料，不能提升为系统指令。超出上下文预算时明确提示选择数据，不静默截断完整工具。

解释请求保留当前工具；修改请求让模型返回完整新revision，用户可看到版本关系。新版接收/启动/恢复失败，保留旧版和旧快照；不会先删除现有工具。

子frame没有sendChat、访问API key、通用chrome调用或任意存储读写接口。只有扩展外侧的真实用户动作允许发送；伪造postMessage和SDK调用不能代替用户点击。协议绑定frame source、实例、工具/版本、请求ID和会话；null origin不是身份认证。

## 资源与网络边界

默认本地工具：禁止外部脚本、fetch/XHR/WebSocket、资源URL、表单提交、弹窗、下载和顶层导航；相机/麦克风/定位等能力不授予。需要网络数据时，后续单独设计有域名及用户授权范围的宿主代理，首版不开放通用代理。

仅connect-src none不覆盖自身导航，禁止同源访问也不等于禁止网络。嵌套宿主frame-src及子frame CSP需一起验证location导航、meta refresh、链接、重定向、CSS URL、SVG/image和data/blob文档。已知外部HTTP测试服务器记录真实请求，不能只监听扩展里的fetch。

依据：[HTML iframe sandbox](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox)、[CSP frame-src及请求检查](https://www.w3.org/TR/CSP3/#directive-frame-src)。嵌套结构可用于增加导航约束是基于标准的设计推断，具体安全结论依赖浏览器原型验收。

## 实施顺序及验证

1. 隔离原型与失败边界 → verify：完整HTML/style/script正常运行，标准DOM/Canvas/SVG/动画有效；模型无法访问父页/API/key；外部请求、导航和伪造发送均被拒绝。用隔离浏览器及测试服务器，JS死循环测试设置进程级测试超时。失败则修正运行结构，不降低目标为JSON语言。
2. 工具身份、版本和状态 → verify：计算器输入/结果、图表参数、模拟位置/速度/时间在收起、重开、重启浏览器及切对话后恢复；不同工具不串状态，确认序列不会被迟到消息覆盖；容量/保存失败可见。
3. 消息内显示与同frame放大 → verify：420px与宽屏交互、放大缩小后状态一致，隐藏工具暂停，源码可复制，旧JSON回复仍可使用。
4. 结果发送与修订 → verify：真实用户点击后仅发一次；草稿/附件保留；解释与完整版本修改沿既有provider/model管线；会话切换、伪造消息和失败修订不影响其它工具。
5. 真实模型及最终包 → verify：至少计算器、动态曲线/参数图表、可暂停的物理模拟三类真实生成案例，含修改和状态恢复。实际原生JS功能不能用宿主预设应用替代。临时key继续仅用于内存代理，不持久化到测试profile或仓库；不重复使用已清除key，联调使用用户已授权的可用凭据。

主要改动范围：`extensions/space-browsa/ai-ui/` 内protocol/panel/sandbox及新增runtime SDK/state模块；`ai-ui-patch.mjs` 追加上游消息身份、后台持久化和发送入口补丁；构建配方记录新增文件哈希；相关单测/E2E及AI UI文档。保留许可、固定扩展ID和已加载目录；1.0.6不覆盖旧包，不自动发布。

验证命令：定向Vitest与实际扩展Playwright；`npm run check`、`npm test`、`npm run build`、`npm run browsa:build`、`npm audit --audit-level=moderate`、`git diff --check`；核对包来源、配方哈希和权限/CSP变化。主扩展CSP不能因生成脚本而放宽，sandbox CSP变动需明确记录。Windows Edge验收与macOS Chromium结果分别报告。

## 本次输出与未完成项

本段原为方案阶段状态。用户随后批准实施1.0.6，原生JS工具、持久状态、放大、结果对话及版本关系已完成；最终命令、三类真实模型验收、包身份及剩余边界见docs/ai-ui.md。原生同步JS无通用硬中断保证，不将这一限制描述为已解决。
