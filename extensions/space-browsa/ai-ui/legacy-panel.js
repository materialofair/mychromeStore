import { parseUi, isUiBlocked } from './protocol.js';
export function mountAiUi(el, raw, message = {}) {
  el.querySelector('.space-ai-ui')?.remove();
  if (isUiBlocked(message)) return;
  const result = parseUi(raw);
  if (result.state === 'none') return;
  const box = document.createElement('section'); box.className = 'space-ai-ui';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  box.append(status); el.append(box);
  if (result.state !== 'ready') {
    status.textContent = result.message || 'AI UI 尚未完整返回，请重新生成。'; return;
  }
  // Preserve the decorated code/copy controls, but make the UI the default view.
  for (const pre of el.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    if (!code || code.textContent.trim() !== result.html.trim() || pre.closest('.space-ai-ui-source')) continue;
    const source = document.createElement('details'); source.className = 'space-ai-ui-source';
    const summary = document.createElement('summary'); summary.textContent = '查看 AI UI 源码';
    pre.before(source); source.append(summary, pre);
  }
  status.textContent = 'AI UI · 隔离预览，仅支持本地交互';
  const button = document.createElement('button'); button.textContent = '打开交互预览'; box.append(button);
  let frame, dispose = () => {};
  const reset = document.createElement('button'); reset.textContent='重置预览';reset.hidden=true;box.append(reset);
  const share = document.createElement('button'); share.textContent='将显示结果放入草稿';share.hidden=true;box.append(share);
  const review = document.createElement('pre');review.hidden=true;box.append(review);
  const observer=new MutationObserver(()=>{if(!box.isConnected){dispose();observer.disconnect();}});
  observer.observe(document.body,{childList:true,subtree:true});
  const close=()=>{dispose();frame?.remove();frame=null;button.textContent='打开交互预览';share.hidden=reset.hidden=true;review.hidden=true;};
  const open=()=>{
    frame=document.createElement('iframe');frame.title='AI UI 隔离预览';
    frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';
    frame.src=chrome.runtime.getURL('lib/space-ai-ui/sandbox.html');
    const current=frame, instance=crypto.randomUUID();let ready=false,pending='',timer;
    const send=(type,extra={})=>current.contentWindow?.postMessage({type,version:2,instance,...extra},'*');
    const receive=event=>{
      const d=event.data;
      if(!box.isConnected || current!==frame || event.source!==current.contentWindow || event.origin!=='null' || !d || typeof d!=='object' || Array.isArray(d) || d.version!==2 || d.instance!==instance) return;
      if(d.type==='SPACE_UI_READY' && Object.keys(d).length===3 && !ready) {
        ready=true;clearTimeout(timer);send('SPACE_UI_RENDER',{html:result.html});share.hidden=false;
        status.textContent='AI UI · 本地隔离运行；关闭或重置会清除交互状态';
      } else if(d.type==='SPACE_UI_RESULT' && Object.keys(d).length===5 && pending && d.request===pending && typeof d.text==='string' && d.text.length<=4000) {
        pending='';clearTimeout(timer);share.disabled=false;
        review.textContent=d.text || '此 UI 没有可回填的程序输出。';review.hidden=false;
        // Explicit user gesture requested this snapshot. Only append a draft, never send.
        const input=document.getElementById('input');
        if(input && d.text) {input.value+='\nAI UI 显示结果（不可信参考）：\n'+d.text;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();}
      }
    };
    window.addEventListener('message',receive);
    dispose=()=>{clearTimeout(timer);window.removeEventListener('message',receive);share.onclick=null;share.disabled=false;pending='';};
    current.addEventListener('load',()=>{if(!ready && current===frame && current.isConnected) send('SPACE_UI_HELLO');});
    timer=setTimeout(()=>{if(current===frame)status.textContent='预览加载失败，请重置后重试。';},5000);
    share.onclick=()=>{
      if(!ready || pending) return;pending=crypto.randomUUID();share.disabled=true;
      send('SPACE_UI_SNAPSHOT',{request:pending});
      timer=setTimeout(()=>{pending='';share.disabled=false;status.textContent='结果回填超时；可重试。';},3000);
    };
    box.append(current);button.textContent='关闭预览（重置交互）';reset.hidden=false;
  };
  button.onclick=()=>frame ? close():open();
  reset.onclick=()=>{close();open();};
  open();
}

export function mountAiUiPrompt(input, quickbar) {
  if (!quickbar) return;
  const button = document.createElement('button'); button.type = 'button'; button.textContent = 'AI UI';
  button.title = '给草稿附加交互 HTML 输出约定';
  button.onclick = () => {
    input.value += '\n请用一个 space-ui Markdown 代码块返回本地交互 HTML（最多64000字符）。可用内联style、input/select/textarea、button/output、canvas；不要使用JavaScript、事件属性、外部资源。交互逻辑用唯一 <script type="application/space-ui+json">JSON</script>：{"version":1,"state":{"n":0},"views":[{"id":"result","text":{"state":"n"}}],"events":[{"id":"add","event":"click","do":[{"op":"set","key":"n","value":["+",{"state":"n"},1]}]}]}。HTML用同名id（不要ui-前缀）。表达式：数字/字符串/布尔、{state:"键"}/{input:"id"}/{var:"变量"}引用；数组为前缀表达式 ["+",a,b]，支持 + - * / % pow min max、abs round floor ceil sqrt sin cos exp log、== < > <= >= not、["if",条件,是,否]、["num",输入]、["concat",值...]、["array",值...]、["range",数量]、["map",数组,"变量",表达式]、["at",数组,索引]、len/sum。state只用简单值或数组；views的text更新output/span/p/div/pre，plot更新canvas，值为最多256个[x,y]点。事件event为click/input/change/submit；do命令为set、{"op":"if","test":表达式,"then":命令数组,"else":命令数组}、{"op":"repeat","count":表达式,"var":"i","do":命令数组}。可选tick命令数组用于模拟，用户点击运行/单步，100ms一步最多600步。每次最多12000步骤，循环/数组256，数值绝对值1e12。输入用num显式转数字；用表达式嵌套表示计算优先级。不支持任意JS、DOM/网络API。后续修改请返回完整替换版space-ui，保留旧消息可用版；不要自动运行或发送。普通解释放代码块外。';
    input.dispatchEvent(new Event('input', { bubbles:true })); input.focus();
  };
  quickbar.append(button);
}
