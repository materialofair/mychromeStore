export const TOOL_PROMPT = `
请生成一个完整、自包含、可直接操作的HTML/CSS/JavaScript工具，用唯一的space-ui Markdown代码块返回完整HTML页面。可以使用<style>、普通<script>、DOM事件、Canvas、SVG、CSS和requestAnimationFrame；交互和计算逻辑由你用真正JavaScript实现，不使用application/space-ui+json运算语言。不要加载外部脚本、库、图片、字体或访问网络；不使用eval/Function、弹窗、导航、下载、iframe、Worker或扩展API。布局响应式，所有元素box-sizing:border-box，输入/Canvas适应窄窗口。
页面中已提供可信生命周期SDK window.spaceTool：
1. 先在异步初始化中 const restored = await spaceTool.loadState(); 根据restored或默认值建立应用state，恢复输入、结果、图表数据、模拟参数/位置/速度/时间/随机种子。
2. 每次有意义的状态变化调用 await spaceTool.saveState(state); 只存有限的JSON可序列化数据，不存DOM、函数、闭包或无限增长的数组。保存错误需要在界面明确展示。每个工具最多约60,000字符数据。
3. 每次结果变化调用 spaceTool.setResult({summary:"当前结果的简明描述",data:结果JSON}); 它只更新本地待分享结果，不发送给AI。
4. 动画/模拟提供运行、暂停、单步和重置按钮；默认暂停，不自动启动。spaceTool.onPause(()=>{running=false; /* 保存当前模拟状态 */}) 注册暂停回调，不要用字符串定时器。
5. <meta name="space-tool" content="1"> 标识本工具。函数、事件绑定、状态和图表全部自行实现，不假定存在其它框架或预置应用。不要生成自动发送对话的代码。
修改工具时返回完整新版HTML，包含上述状态恢复和结果接口。代码尽量紧凑，减少重复样式和说明，优先保证交互、状态接口以及一次响应内完整闭合代码块。说明放代码块外。完整HTML不超过64,000字符，不返回残缺代码。`;
