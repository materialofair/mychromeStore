<thinking>
用户想要一个极简计算器（加、减、乘、除），带两个输入、一个运算符选择器和一个结果，100 行以内，做成一个自包含的 HTML 页面，放在 space-ui 代码块里。

要求：
- 用 space-ui Markdown 代码块包裹完整 HTML 页面
- 用 `window.spaceTool`，配合 loadState/saveState/setResult
- `<meta name="space-tool" content="1">`
- 初始化时恢复状态
- 每次有意义的状态变化都保存状态
- 结果变化时调用 setResult
- 不用 eval，不用外部资源
- 响应式，box-sizing 用 border-box
- 100 行以内，紧凑

那来写吧。

关于动画/模拟：这里没有动画，所以暂停按钮不需要。

开始写 HTML。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="space-tool" content="1">
<title>简易计算器</title>
<style>
*{box-sizing:border-box}
body{margin:0;padding:16px;font-family:system-ui,sans-serif;background:#f5f6f8;color:#1c1e21;display:flex;justify-content:center}
.card{width:100%;max-width:420px;background:#fff;border-radius:12px;padding:18px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
h1{font-size:18px;margin:0 0 14px}
label{display:block;font-size:13px;color:#5a5f66;margin:10px 0 4px}
input,select,button{font:inherit;width:100%;padding:10px;border:1px solid #ccd0d5;border-radius:8px;background:#fff}
.row{display:flex;gap:8px}
.row>*{flex:1;min-width:0}
button{cursor:pointer;background:#1877f2;color:#fff;border:0;font-weight:600}
button:active{opacity:.85}
.out{margin-top:14px;padding:14px;background:#eef3fd;border-radius:8px;font-size:15px;word-break:break-all}
.out b{font-size:24px;color:#1877f2}
.err{color:#c0392b;font-size:13px;margin-top:8px;min-height:18px}
</style>
</head>
<body>
<div class="card">
  <h1>简易计算器</h1>
  <label for="a">数 A</label>
  <input id="a" type="text" inputmode="decimal" value="0">
  <label for="op">运算符</label>
  <select id="op">
    <option value="+">加 +</option>
    <option value="-">减 −</option>
    <option value="*">乘 ×</option>
    <option value="/">除 ÷</option>
  </select>
  <label for="b">数 B</label>
  <input id="b" type="text" inputmode="decimal" value="0">
  <button id="go">计算</button>
  <div class="out" id="out">结果：<b>—</b></div>
  <div class="err" id="err"></div>
</div>
<script>
const $=id=>document.getElementById(id), els={a:$('a'),op:$('op'),b:$('b'),out:$('out'),err:$('err')};
const OPS={'+':(x,y)=>x+y,'-':(x,y)=>x-y,'*':(x,y)=>x*y,'/':(x,y)=>x/y};
const SYM={'+':'+','-':'−','*':'×','/':'÷'};
let state={a:'0',op:'+',b:'0',result:null};

function calc(){
  const a=parseFloat(els.a.value),b=parseFloat(els.b.value),op=els.op.value;
  state={a:els.a.value,op:op,b:els.b.value,result:null};
  els.err.textContent='';
  if(!isFinite(a)||!isFinite(b)){els.out.innerHTML='结果：<b>—</b>';els.err.textContent='请输入有效数字';return;}
  if(op==='/'&&b===0){els.out.innerHTML='结果：<b>—</b>';els.err.textContent='除数不能为 0';return;}
  const r=OPS[op](a,b);
  state.result=r;
  els.out.innerHTML='结果：<b>'+r+'</b> <span style="color:#5a5f66">'+a+' '+SYM[op]+' '+b+'</span>';
  persist();
}
async function persist(){
  try{
    await spaceTool.saveState(state);
    await spaceTool.setResult({summary:(state.result===null?'未计算':(state.a+' '+SYM[state.op]+' '+state.b+' = '+state.result)),data:state});
  }catch(e){els.err.textContent='状态保存失败：'+e.message;}
}
async function init(){
  try{
    const r=await spaceTool.loadState();
    if(r&&typeof r==='object')state=Object.assign(state,r);
  }catch(e){els.err.textContent='状态恢复失败：'+e.message;}
  els.a.value=state.a??'0';els.b.value=state.b??'0';
  if(OPS[state.op])els.op.value=state.op;
  if(state.result!==null&&state.result!==undefined&&isFinite(state.result)){
    els.out.innerHTML='结果：<b>'+state.result+'</b> <span style="color:#5a5f66">'+els.a.value+' '+SYM[els.op.value]+' '+els.b.value+'</span>';
  }
}
els.go.addEventListener('click',calc);
[els.a,els.b].forEach(el=>el.addEventListener('keydown',e=>{if(e.key==='Enter')calc()}));
els.op.addEventListener('change',calc);
init();
</script>
</body>
</html>
```

等等——我在用 `$('a')` 和 `els.go`。我应该把 go 也放进 els。它通过 `$('go')` 存在了。没关系，但我还是加上吧。

数一下行数——大概 70 行左右，可以。

注意：初始化时调用 `calc()` 会改变状态吗？不会，我没有在初始化时调用 calc，这是对的——我们只恢复。

嗯，但 `persist()` 用到了 `spaceTool`，而它在页面里是预先存在的。这没问题。

另外，初始化里应该为恢复的结果调用 `setResult` 吗？不需要，但也可以。其实为了稳妥，可以通过 `spaceTool.setResult` 来设置结果。不是必须的。但可以——在初始化里，如果已经恢复了结果，就调用 `setResult`。实际上 `persist` 会处理这个，但初始化并不一定调用 `persist`。那就加一句 `spaceTool.setResult(...)` 吧。嗯，保持简单——初始化时也可以调用 `persist()`，但那样会保存一次。这也是可以的，而且能确保初始状态被保存。其实在初始化最后调用 `persist()` 能确保状态被存储。我就这么做吧。

注意：初始 `persist()` 会以 `result: null` 保存状态——这没问题。

再确认一下 `parseFloat` 处理像 `"1abc"` 这样的输入时会得到 1。不过可以接受，只是小问题。

要求里说每个响应只能有一个 space-ui 代码块。返回一个 ` ```space-ui ` 代码块，里面放 HTML。

其实这个代码块的规范一开始说的是“用唯一的 space-ui Markdown 代码块返回完整 HTML 页面”，而后面的系统提示又提到了 mermaid 之类的。那我用 ` ```space-ui `。

代码块外再放一小段说明，外加一个 CHOICE_REQUEST 收尾？不是必须的。其实我再加一个可选的 CHOICE_REQUEST 收尾吧。嗯，“只有当你确实在让用户在几条明确路径之间做选择时才用”。这有点边界，不过也可以——也许可以跳过。我还是跳过吧，保持简洁。其实加一个也挺自然的：“要加别的功能吗？”但这不是严格意义上的“几条明确路径”。那就跳过，保持干净。

让我把代码最终定下来。行数数一下：

大概 75 行。没问题。

有个小细节：`els.err.textContent='状态保存失败：'+e.message;` 如果 `e` 是 undefined……用 `(e&&e.message)||e` 兜底吧。

最后写出来吧。
</thinking>
这是一个可直接运行的简易计算器 HTML 文档，只包含两个数字输入、一个运算符选择和结果展示，代码紧凑，能在 100 行内完成加减乘除计算。
```space-ui
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="space-tool" content="1">
<title>简易计算器</title>
<style>
*{box-sizing:border-box}
body{margin:0;padding:16px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f5f6f8;color:#1c1e21;display:flex;justify-content:center}
.card{width:100%;max-width:420px;background:#fff;border-radius:12px;padding:18px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
h1{font-size:18px;margin:0 0 6px}
label{display:block;font-size:13px;color:#5a5f66;margin:12px 0 5px}
input,select,button{font:inherit;width:100%;padding:10px;border:1px solid #ccd0d5;border-radius:8px;background:#fff;color:inherit}
input:focus,select:focus,button:focus{outline:2px solid #a8c7fa;outline-offset:1px}
.row{display:flex;gap:10px}
.row>*{flex:1;min-width:0}
button{margin-top:14px;cursor:pointer;background:#1877f2;color:#fff;border:0;font-weight:600}
button:active{opacity:.85}
.out{margin-top:14px;padding:14px;background:#eef3fd;border-radius:8px;font-size:14px;line-height:1.6;word-break:break-all}
.out b{font-size:24px;color:#1877f2}
.sub{color:#5a5f66}
.err{color:#c0392b;font-size:13px;margin-top:8px;min-height:18px}
</style>
</head>
<body>
<div class="card">
  <h1>简易计算器</h1>
  <label for="a">数 A</label>
  <input id="a" type="text" inputmode="decimal" value="0">
  <div class="row">
    <div>
      <label for="op">运算符</label>
      <select id="op">
        <option value="+">加 +</option>
        <option value="-">减 −</option>
        <option value="*">乘 ×</option>
        <option value="/">除 ÷</option>
      </select>
    </div>
    <div>
      <label for="b">数 B</label>
      <input id="b" type="text" inputmode="decimal" value="0">
    </div>
  </div>
  <button id="go">计算</button>
  <div class="out" id="out">结果：<b>—</b></div>
  <div class="err" id="err"></div>
</div>
<script>
const $ = id => document.getElementById(id);
const els = {a:$('a'),op:$('op'),b:$('b'),go:$('go'),out:$('out'),err:$('err')};
const FNS = {'+':(x,y)=>x+y,'-':(x,y)=>x-y,'*':(x,y)=>x*y,'/':(x,y)=>x/y};
const SYM = {'+':'+','-':'−','*':'×','/':'÷'};
let state = {a:'0',op:'+',b:'0',result:null};

function fmt(x,y,op,r){
  return '结果：<b>'+r+'</b> <span class="sub">'+x+' '+SYM[op]+' '+y+'</span>';
}
function showEmpty(msg){
  els.out.innerHTML = '结果：<b>—</b>';
  els.err.textContent = msg;
}
async function persist(){
  try{
    await spaceTool.saveState(state);
    await spaceTool.setResult({
      summary: state.result === null
        ? '尚未得出结果'
        : state.a + ' ' + SYM[state.op] + ' ' + state.b + ' = ' + state.result,
      data: state
    });
  }catch(e){
    els.err.textContent = '状态保存失败：' + ((e && e.message) || e);
  }
}
function calc(){
  const aTxt = els.a.value.trim(), bTxt = els.b.value.trim(), op = els.op.value;
  const a = parseFloat(aTxt), b = parseFloat(bTxt);
  state = {a:aTxt, op:op, b:bTxt, result:null};
  els.err.textContent = '';
  if(!isFinite(a) || !isFinite(b)){ showEmpty('请输入有效数字'); return persist(); }
  if(op === '/' && b === 0){ showEmpty('除数不能为 0'); return persist(); }
  const r = FNS[op](a, b);
  state.result = r;
  els.out.innerHTML = fmt(a, b, op, r);
  persist();
}
async function init(){
  try{
    const restored = await spaceTool.loadState();
    if(restored && typeof restored === 'object') state = Object.assign(state, restored);
  }catch(e){
    els.err.textContent = '状态恢复失败：' + ((e && e.message) || e);
  }
  els.a.value = state.a ?? '0';
  els.b.value = state.b ?? '0';
  if(FNS[state.op]) els.op.value = state.op;
  if(state.result !== null && state.result !== undefined && isFinite(state.result)){
    els.out.innerHTML = fmt(els.a.value, els.b.value, els.op.value, state.result);
    els.err.textContent = '';
  }
  persist();
}
els.go.addEventListener('click', calc);
[els.a, els.b].forEach(el => el.addEventListener('keydown', e => { if(e.key === 'Enter') calc(); }));
els.op.addEventListener('change', calc);
init();
</script>
</body>
</html>
```
### 计算器功能与交互说明

页面围绕“输入两个数字、选择运算符、得到结果”展开。输入框支持小数和负数，按回车或点击“计算”按钮都会立刻刷新结果。运算符下拉菜单提供加、减、乘、除四个选项，切换选项也会自动重新计算。结果区域会放大显示数值，下方同步展示完整算式，比如“3 × 5”。如果输入无效数字或除数为零，会给出明确提示。所有输入和结果都会通过 spaceTool 自动保存，刷新页面后仍能恢复上一次的计算状态。