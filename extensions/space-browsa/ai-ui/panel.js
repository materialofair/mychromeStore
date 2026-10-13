import { parseUi, isUiBlocked, isLegacyUi, hasUiProgram } from './protocol.js';
import { mountAiUi as mountLegacy } from './legacy-panel.js';
import { TOOL_PROMPT } from './tool-prompt.js';
import { validateToolSnapshot } from './tool-state.js';

export async function prepareToolHistory() {
  const reply = await chrome.runtime.sendMessage({ type: 'SPACE_TOOL_STATE', op: 'PREPARE' });
  if (!reply?.ok) throw new Error(reply?.error || '无法准备工具历史');
}
const mounts = new WeakMap();
const exact = (d, keys) => d && typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length === keys.length && keys.every(k => Object.hasOwn(d,k));
const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
export function collapseToolSource(el, raw, message = {}) {
  if(isUiBlocked(message))return;
  const result=parseUi(raw);if(result.state!=='ready')return;
  for (const pre of el.querySelectorAll('pre')) {
    const code=pre.querySelector('code');
    if (!code || pre.closest('.space-ai-ui-source,.think-block,blockquote')) continue;
    const declared=code.classList.contains('language-space-ui') || (code.classList.contains('language-html') && hasUiProgram(code.textContent));
    if(code.textContent.trim()!==result.html.trim() && !declared)continue;
    // Chat math rendering can rewrite $ expressions inside a code fence.
    // Restore the immutable tool source as text before folding/copying it.
    code.textContent=result.html;
    const details = document.createElement('details'); details.className = 'space-ai-ui-source';
    const summary = document.createElement('summary'); summary.textContent = '查看工具源码';
    pre.before(details); details.append(summary,pre);
  }
}

export async function mountAiUi(el, raw, message = {}, options = {}) {
  mounts.get(el)?.();
  el.querySelector('.space-ai-ui')?.remove();
  if (isUiBlocked(message)) return;
  const parsed = parseUi(raw);
  if (parsed.state === 'none') return;
  if (parsed.state === 'ready' && isLegacyUi(parsed.html)) {
    mountLegacy(el,raw,message); return;
  }
  const box = document.createElement('section'); box.className = 'space-ai-ui';
  box.dataset.toolMessageId=message.spaceToolMessageId || '';
  const status = document.createElement('p'); status.className = 'space-tool-status'; status.setAttribute('role','status'); box.append(status); el.append(box);
  if (parsed.state !== 'ready') { status.textContent = parsed.message || '工具尚未完整返回，请重新生成。'; return; }
  const version=document.createElement('p');version.className='space-tool-version';
  version.textContent=message.spaceToolParentId ? '修改版 · 原版及状态已保留' : '初始版本';box.append(version);
  collapseToolSource(el,raw,message);
  const controls=[];
  const makeButton = (label, handler) => { const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=handler;box.append(b);controls.push(b);return b; };
  if(message.spaceToolParentId) makeButton('查看原版',e=>{
    if(!e.isTrusted)return;
    const original=[...document.querySelectorAll('.space-ai-ui')].find(el=>el.dataset.toolMessageId===message.spaceToolParentId);
    if(original)original.scrollIntoView({block:'center'});else status.textContent='原版未在当前显示范围，请从会话历史查看';
  });
  let frame, instance, lease, sourceHash, closing = false, opening=false, generation=0, disposed = false, ready = false, saveChain = Promise.resolve(), watchdog, runtimeError='';
  const updateControls=()=>controls.forEach(b=>b.disabled=opening || closing || disposed);
  const requests = new Map();
  const base = { type:'SPACE_TOOL_STATE', messageId:message.spaceToolMessageId };
  const stateCall = async (op, extra = {}) => {
    const reply = await chrome.runtime.sendMessage({ ...base, op, sourceHash, ...extra });
    if (!reply?.ok) throw new Error(reply?.error || '工具状态操作失败'); return reply.data;
  };
  const setError = error => { status.textContent = '工具错误：' + String(error?.message || error).slice(0,400); };
  const send = (type, extra={}) => frame?.contentWindow?.postMessage({type,version:3,instance,...extra},'*');
  const request = type => new Promise((resolve,reject) => {
    if (!ready) { reject(new Error('工具尚未就绪')); return; }
    const id=crypto.randomUUID();
    const timer=setTimeout(()=>{requests.delete(id);reject(new Error('工具无响应；最近保存的状态仍可恢复'));},5500);
    requests.set(id,{resolve,reject,timer}); send(type,{request:id});
  });
  const review = document.createElement('section');review.className='space-tool-review';review.hidden=true;
  const notice=document.createElement('p');notice.textContent='发送会合并当前草稿及已选择附件。工具资料作为不可信参考交给当前模型。';review.append(notice);
  const output=document.createElement('pre'), question=document.createElement('textarea');question.placeholder='请解释结果，或描述想修改的功能';question.setAttribute('aria-label','工具结果提问');
  const sendButton=document.createElement('button');sendButton.textContent='发送给 AI';sendButton.type='button';
  const reviseButton=document.createElement('button');reviseButton.textContent='修改这个工具';reviseButton.type='button';
  review.append(output,question,sendButton,reviseButton);
  let selectedResult=null;
  const transmit = async (event, revise) => {
    if (!event.isTrusted || !selectedResult || !box.isConnected || closing || !options.sendResult) return;
    sendButton.disabled=reviseButton.disabled=true;
    try {
      const contextGuard=options.captureContext?.() || (()=>box.isConnected);
      const current = await chrome.runtime.sendMessage({type:'SPACE_TOOL_STATE',op:'PREPARE'});
      if(disposed || !box.isConnected || !contextGuard())throw new Error('页面或会话已改变，结果未发送');
      if (!current?.ok || !current.data.history.some(m=>m.spaceToolMessageId===message.spaceToolMessageId)) throw new Error('原工具不在当前对话，未发送');
      const resultText=JSON.stringify(selectedResult,null,2);
      if(resultText.length>12000) throw new Error('结果超过12,000字符，请在工具中选择较小的数据范围后分享');
      await options.sendResult({messageId:message.spaceToolMessageId, sourceHash, html:parsed.html, result:selectedResult, question:question.value, revise, contextGuard});
      review.hidden=true; status.textContent='结果已交给当前对话';
    } catch(error) { setError(error); }
    finally { sendButton.disabled=reviseButton.disabled=false; }
  };
  sendButton.onclick=e=>transmit(e,false);reviseButton.onclick=e=>transmit(e,true);
  const close = async () => {
    if (closing || opening || !frame) return false;
    closing=true;updateControls();
    try {
      await request('SPACE_TOOL_CLOSE'); await saveChain;
      clearTimeout(watchdog); frame.remove();frame=null;ready=false;box.classList.remove('space-ai-ui-expanded');
      zoom.textContent='放大';collapse.textContent='重新打开';review.hidden=true;status.textContent='已保存 · 重新打开将恢复状态';return true;
    } catch(error) { setError(error);return false; }
    finally { closing=false;updateControls(); }
  };
  const collapse=makeButton('收起', async e=>{if(!e.isTrusted || opening || closing)return;if(frame)await close();else await open();});
  const zoom=makeButton('放大',e=>{if(!e.isTrusted || !frame)return;const expanded=box.classList.toggle('space-ai-ui-expanded');zoom.textContent=expanded?'缩小':'放大';});
  makeButton('停止',e=>{if(e.isTrusted && ready){send('SPACE_TOOL_PAUSE');status.textContent='已请求暂停动画和定时器';}});
  makeButton('重启',async e=>{if(!e.isTrusted || closing)return;if(frame && !await close()){frame.remove();frame=null;ready=false;}await open();});
  makeButton('重置',async e=>{if(!e.isTrusted || !await close())return;try{await stateCall('RESET',{lease});await open();}catch(error){setError(error);}});
  const share=makeButton('把结果发给 AI',async e=>{
    if(!e.isTrusted || !ready || closing)return;share.disabled=true;
    try {const value=await request('SPACE_TOOL_SNAPSHOT');if(!value || typeof value.summary!=='string')throw new Error('工具尚未提供结果；请先进行操作');selectedResult=value;output.textContent=JSON.stringify(value,null,2);review.hidden=false;}
    catch(error){setError(error);}finally{share.disabled=false;}
  });
  box.append(review);
  const receive = event => {
    const d=event.data;
    if(disposed || !box.isConnected || !frame || event.source!==frame.contentWindow || event.origin!=='null' || !d || d.version!==3 || d.instance!==instance) return;
    if(d.type==='SPACE_TOOL_READY' && exact(d,['type','version','instance'])) {
      ready=true;clearTimeout(watchdog);if(!runtimeError)status.textContent='HTML/CSS/JS 工具 · 本地隔离运行 · 尚未保存状态';
    } else if(d.type==='SPACE_TOOL_SAVE' && exact(d,['type','version','instance','request','state']) && Number.isSafeInteger(d.request)) {
      try {validateToolSnapshot(d.state);}catch(error){setError(error);send('SPACE_TOOL_SAVED',{request:d.request,error:String(error.message).slice(0,400)});return;}
      const receivedInstance=instance,requestId=d.request;
      saveChain=saveChain.catch(()=>{}).then(async()=>{
        if(disposed || receivedInstance!==instance)return;
        try {await stateCall('SAVE',{lease,state:d.state});if(receivedInstance!==instance)return;send('SPACE_TOOL_SAVED',{request:requestId});if(runtimeError){setError(runtimeError+'；最近状态已保存，可重启');}else if(d.state.data!==null){status.textContent='已保存 · 重开可恢复';}else{status.textContent='表单已保存 · 应用尚未保存状态';}}
        catch(error){if(receivedInstance===instance){setError(error);send('SPACE_TOOL_SAVED',{request:requestId,error:String(error.message).slice(0,400)});}}
      });
    } else if((d.type==='SPACE_TOOL_RESULT' && exact(d,['type','version','instance','request','result'])) || (d.type==='SPACE_TOOL_CLOSED' && exact(d,['type','version','instance','request']))) {
      const p=requests.get(d.request);if(!p)return;
      if(d.type==='SPACE_TOOL_RESULT') {try {validateToolSnapshot({data:null,forms:{},result:d.result});}catch(error){requests.delete(d.request);clearTimeout(p.timer);p.reject(error);return;}}
      requests.delete(d.request);clearTimeout(p.timer);p.resolve(d.result);
    } else if(d.type==='SPACE_TOOL_ERROR' && exact(d,['type','version','instance','error']) && typeof d.error==='string') {
      runtimeError=d.error;clearTimeout(watchdog);setError(d.error);
      for(const p of requests.values()){clearTimeout(p.timer);p.reject(new Error(d.error));}requests.clear();
    }
  };
  window.addEventListener('message',receive);
  const dispose = () => {
    disposed=true;generation++;clearTimeout(watchdog);window.removeEventListener('message',receive);observer.disconnect();
    for(const p of requests.values()){clearTimeout(p.timer);p.reject(new Error('工具已离开当前对话'));}requests.clear();mounts.delete(el);
  };
  const observer=new MutationObserver(()=>{if(!box.isConnected)dispose();});observer.observe(document.body,{childList:true,subtree:true});mounts.set(el,dispose);
  async function open() {
    if(opening || closing || frame || disposed)return;
    opening=true;const currentGeneration=++generation;updateControls();
    status.textContent='正在加载工具与保存状态…';
    try {
      const loaded=await stateCall('LOAD');if(disposed || !box.isConnected || currentGeneration!==generation)return;
      lease=loaded.lease;instance=crypto.randomUUID();ready=false;runtimeError='';
      frame=document.createElement('iframe');frame.title='HTML/CSS/JS 隔离工具';frame.dataset.instance=instance;frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';
      frame.src=chrome.runtime.getURL('lib/space-ai-ui/native-host.html');
      const current=frame, currentInstance=instance;
      frame.addEventListener('load',()=>{if(current===frame && !disposed)send('SPACE_TOOL_INIT',{html:parsed.html,state:loaded.state});},{once:true});
      box.append(frame);collapse.textContent='收起';
      watchdog=setTimeout(()=>{if(instance===currentInstance && !ready)setError('工具启动失败；源码或脚本需要修订');},6000);
    } catch(error){setError(error);}
    finally {if(currentGeneration===generation){opening=false;updateControls();}}
  }
  try {sourceHash=await hash(parsed.html);await open();}catch(error){setError(error);}
}

export function mountAiUiPrompt(input,quickbar) {
  if(!quickbar)return;
  const button=document.createElement('button');button.type='button';button.textContent='AI UI';button.title='生成完整HTML/CSS/JS工具';
  button.onclick=()=>{input.value+=TOOL_PROMPT;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();};quickbar.append(button);
}
