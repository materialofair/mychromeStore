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
  el.querySelector('.space-tool-blocked')?.remove();
  const parsed = parseUi(raw);
  if (isUiBlocked(message)) {
    if(parsed.state!=='none'){
      const notice=document.createElement('p');notice.className='space-tool-blocked';notice.setAttribute('role','status');
      notice.textContent=message.outputTruncated ? '工具内容已截断，未执行。请重新生成完整工具。' : '工具生成已中断，未执行。请重新生成完整工具。';el.prepend(notice);
    }
    return;
  }
  if (parsed.state === 'none') return;
  if (parsed.state === 'ready' && isLegacyUi(parsed.html)) {
    mountLegacy(el,raw,message); return;
  }
  const box = document.createElement('section'); box.className = 'space-ai-ui space-tool-card';
  box.dataset.toolMessageId=message.spaceToolMessageId || '';
  const header=document.createElement('header');header.className='space-tool-header';
  const heading=document.createElement('h3');heading.className='space-tool-title';heading.id='space-tool-title-'+crypto.randomUUID();
  // Parse only title text in an inert document; never mount model HTML in the host.
  const titleMatch=parsed.html?.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title\s*>/i);
  const title=titleMatch ? new DOMParser().parseFromString('<title>'+titleMatch[1]+'</title>','text/html').title.replace(/\s+/g,' ').trim() : '';
  heading.textContent=title ? [...title].slice(0,80).join('') : '交互工具';heading.title=heading.textContent;
  const version=document.createElement('span');version.className='space-tool-version';
  version.textContent=message.spaceToolParentId ? '修改版' : '初始版本';
  if(message.spaceToolParentId)version.title='原版及状态已保留';
  const identity=document.createElement('div');identity.className='space-tool-identity';identity.append(heading,version);header.append(identity);
  const status = document.createElement('div'); status.className = 'space-tool-status'; status.setAttribute('role','status');
  const saveFeedback=document.createElement('p');saveFeedback.className='space-tool-save-status';
  const errorFeedback=document.createElement('p');errorFeedback.className='space-tool-error';errorFeedback.hidden=true;status.append(saveFeedback,errorFeedback);
  const toolChrome=document.createElement('div');toolChrome.className='space-tool-chrome';toolChrome.append(header,status);box.append(toolChrome);el.append(box);
  if (parsed.state !== 'ready') { saveFeedback.textContent = parsed.message || '工具尚未完整返回，请重新生成。'; return; }
  collapseToolSource(el,raw,message);
  const controls=[];
  const toolbar=document.createElement('div');toolbar.className='space-tool-toolbar';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','工具操作');toolChrome.append(toolbar);
  const menuWrap=document.createElement('div');menuWrap.className='space-tool-more';header.append(menuWrap);
  const menu=document.createElement('div');menu.className='space-tool-menu';menu.hidden=true;menu.id='space-tool-menu-'+crypto.randomUUID();menu.setAttribute('role','group');menu.setAttribute('aria-label','更多工具操作');
  const makeButton = (label, handler, parent=toolbar) => { const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=handler;parent.append(b);controls.push(b);return b; };
  let frame, instance, lease, sourceHash, closing = false, opening=false, generation=0, disposed = false, ready = false, saveChain = Promise.resolve(), watchdog, runtimeError='';
  const updateControls=()=>controls.forEach(b=>b.disabled=opening || closing || disposed);
  const closeMenu=(restoreFocus=false)=>{menu.hidden=true;more.setAttribute('aria-expanded','false');if(restoreFocus && more.isConnected)more.focus({preventScroll:true});};
  const more=makeButton('更多工具操作',e=>{
    if(!e.isTrusted)return;
    menu.hidden=!menu.hidden;more.setAttribute('aria-expanded',String(!menu.hidden));
    if(!menu.hidden)menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  },menuWrap);more.className='space-tool-more-button';more.setAttribute('aria-controls',menu.id);more.setAttribute('aria-expanded','false');menuWrap.append(menu);
  let zoomReturn=null;
  const setExpanded=expanded=>{
    if(expanded===box.classList.contains('space-ai-ui-expanded'))return;
    closeMenu();
    if(expanded){
      const scroll=[];for(let node=box.parentElement;node;node=node.parentElement)scroll.push([node,node.scrollLeft,node.scrollTop]);
      zoomReturn={focus:document.activeElement,scroll,windowX:window.scrollX,windowY:window.scrollY};
      box.classList.add('space-ai-ui-expanded');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-labelledby',heading.id);zoom.textContent='缩小';zoom.focus({preventScroll:true});
    }else{
      box.classList.remove('space-ai-ui-expanded');box.removeAttribute('role');box.removeAttribute('aria-modal');box.removeAttribute('aria-labelledby');zoom.textContent='放大';
      if(zoomReturn){const saved=zoomReturn;zoomReturn=null;if(saved.focus?.isConnected)saved.focus.focus({preventScroll:true});for(const [node,x,y] of saved.scroll){node.scrollLeft=x;node.scrollTop=y;}window.scrollTo(saved.windowX,saved.windowY);}
    }
  };
  const requests = new Map();
  const base = { type:'SPACE_TOOL_STATE', messageId:message.spaceToolMessageId };
  const stateCall = async (op, extra = {}) => {
    const reply = await chrome.runtime.sendMessage({ ...base, op, sourceHash, ...extra });
    if (!reply?.ok) throw new Error(reply?.error || '工具状态操作失败'); return reply.data;
  };
  const setError = error => { const text=String(error?.message || error).slice(0,400);errorFeedback.textContent='工具错误：'+(runtimeError && text!==runtimeError ? runtimeError+'；'+text : text);errorFeedback.hidden=false; };
  const send = (type, extra={}) => frame?.contentWindow?.postMessage({type,version:3,instance,...extra},'*');
  const request = type => new Promise((resolve,reject) => {
    if (!ready) { reject(new Error('工具尚未就绪')); return; }
    const id=crypto.randomUUID();
    const timer=setTimeout(()=>{requests.delete(id);reject(new Error('工具无响应；最近保存的状态仍可恢复'));},5500);
    requests.set(id,{resolve,reject,timer}); send(type,{request:id});
  });
  const review = document.createElement('section');review.className='space-tool-review';review.hidden=true;
  const resultSummary=document.createElement('p');resultSummary.className='space-tool-result-summary';review.append(resultSummary);
  const notice=document.createElement('p');notice.textContent='发送会合并当前草稿及已选择附件。工具资料作为不可信参考交给当前模型。';review.append(notice);
  const rawDetails=document.createElement('details'),rawSummary=document.createElement('summary');rawSummary.textContent='查看结构化数据';rawDetails.append(rawSummary);
  const output=document.createElement('pre'), question=document.createElement('textarea');question.placeholder='请解释结果，或描述想修改的功能';question.setAttribute('aria-label','工具结果提问');
  rawDetails.append(output);
  const sendButton=document.createElement('button');sendButton.textContent='发送给 AI';sendButton.type='button';
  const reviseButton=document.createElement('button');reviseButton.textContent='修改这个工具';reviseButton.type='button';
  const cancelReview=document.createElement('button');cancelReview.textContent='取消';cancelReview.type='button';
  cancelReview.onclick=e=>{if(!e.isTrusted)return;review.hidden=true;share.focus({preventScroll:true});};
  const reviewActions=document.createElement('div');reviewActions.className='space-tool-review-actions';reviewActions.append(sendButton,reviseButton,cancelReview);review.append(rawDetails,question,reviewActions);
  let selectedResult=null,transmitting=false;
  const transmit = async (event, revise) => {
    if (!event.isTrusted || !selectedResult || !box.isConnected || closing || transmitting || !options.sendResult) return;
    transmitting=true;
    sendButton.disabled=reviseButton.disabled=true;
    try {
      const contextGuard=options.captureContext?.() || (()=>box.isConnected);
      const current = await chrome.runtime.sendMessage({type:'SPACE_TOOL_STATE',op:'PREPARE'});
      if(disposed || !box.isConnected || !contextGuard())throw new Error('页面或会话已改变，结果未发送');
      if (!current?.ok || !current.data.history.some(m=>m.spaceToolMessageId===message.spaceToolMessageId)) throw new Error('原工具不在当前对话，未发送');
      const resultText=JSON.stringify(selectedResult,null,2);
      if(resultText.length>12000) throw new Error('结果超过12,000字符，请在工具中选择较小的数据范围后分享');
      await options.sendResult({messageId:message.spaceToolMessageId, sourceHash, html:parsed.html, result:selectedResult, question:question.value, revise, contextGuard});
      review.hidden=true; saveFeedback.textContent='结果已交给当前对话';
    } catch(error) { setError(error); }
    finally { transmitting=false;sendButton.disabled=reviseButton.disabled=false; }
  };
  sendButton.onclick=e=>transmit(e,false);reviseButton.onclick=e=>transmit(e,true);
  const close = async () => {
    if (closing || opening || !frame) return false;
    closing=true;updateControls();
    try {
      await request('SPACE_TOOL_CLOSE'); await saveChain;
      clearTimeout(watchdog);setExpanded(false);frame.remove();frame=null;ready=false;
      collapse.textContent='重新打开';review.hidden=true;saveFeedback.textContent='已保存 · 重新打开将恢复状态';return true;
    } catch(error) { setError(error);return false; }
    finally { closing=false;updateControls(); }
  };
  const zoom=makeButton('放大',e=>{if(!e.isTrusted || !frame)return;setExpanded(!box.classList.contains('space-ai-ui-expanded'));});
  const collapse=makeButton('收起', async e=>{if(!e.isTrusted || opening || closing)return;closeMenu();if(frame)await close();else await open();});
  makeButton('停止',e=>{if(e.isTrusted && ready){closeMenu(true);send('SPACE_TOOL_PAUSE');saveFeedback.textContent='已请求暂停动画和定时器';}},menu);
  makeButton('重启',async e=>{if(!e.isTrusted || closing || opening)return;closeMenu(true);if(frame && !await close()){setExpanded(false);frame.remove();frame=null;ready=false;}await open();},menu);
  const resetReview=document.createElement('section');resetReview.className='space-tool-reset';resetReview.hidden=true;resetReview.setAttribute('aria-label','重置工具确认');
  const resetNotice=document.createElement('p');resetNotice.textContent='重置将清除此工具已保存的表单和应用状态，并从初始状态重新打开。原工具源码和聊天记录会保留。';resetReview.append(resetNotice);
  const confirmReset=makeButton('确认重置',async e=>{
    if(!e.isTrusted || opening || closing || disposed)return;
    try{
      if(frame && !await close())return;
      resetReview.hidden=true;
      await stateCall('RESET',{lease});await open();
    }catch(error){setError(error);}
    finally{if(!disposed && box.isConnected)(resetReview.hidden ? collapse : confirmReset).focus({preventScroll:true});}
  },resetReview);
  makeButton('取消',e=>{if(!e.isTrusted)return;resetReview.hidden=true;more.focus({preventScroll:true});},resetReview);
  makeButton('重置工具',e=>{if(!e.isTrusted)return;closeMenu();resetReview.hidden=false;confirmReset.focus({preventScroll:true});},menu);
  makeButton('查看工具源码',e=>{
    if(!e.isTrusted)return;closeMenu();setExpanded(false);
    const source=el.querySelector('.space-ai-ui-source');if(source){source.open=true;source.querySelector('summary')?.focus();source.scrollIntoView({block:'nearest'});}
  },menu);
  if(message.spaceToolParentId)makeButton('查看原版',e=>{
    if(!e.isTrusted)return;closeMenu(true);setExpanded(false);
    const original=[...document.querySelectorAll('.space-ai-ui')].find(el=>el.dataset.toolMessageId===message.spaceToolParentId);
    if(original)original.scrollIntoView({block:'center'});else saveFeedback.textContent='原版未在当前显示范围，请从会话历史查看';
  },menu);
  const footer=document.createElement('footer');footer.className='space-tool-footer';
  const footerHint=document.createElement('span');footerHint.textContent='本地隔离运行 · 结果经确认后发送';footer.append(footerHint);
  const share=makeButton('把结果发给 AI',async e=>{
    if(!e.isTrusted || !ready || closing)return;share.disabled=true;
    try {const value=await request('SPACE_TOOL_SNAPSHOT');if(!value || typeof value.summary!=='string')throw new Error('工具尚未提供结果；请先进行操作');selectedResult=value;resultSummary.textContent=value.summary || '工具未提供文字摘要，请展开数据后确认。';output.textContent=JSON.stringify(value,null,2);rawDetails.open=false;review.hidden=false;question.focus({preventScroll:true});}
    catch(error){setError(error);}finally{share.disabled=false;}
  },footer);
  box.append(resetReview,footer,review);
  const receive = event => {
    const d=event.data;
    if(disposed || !box.isConnected || !frame || event.source!==frame.contentWindow || event.origin!=='null' || !d || d.version!==3 || d.instance!==instance) return;
    if(d.type==='SPACE_TOOL_READY' && exact(d,['type','version','instance'])) {
      ready=true;clearTimeout(watchdog);saveFeedback.textContent='运行中 · 尚未保存状态';
    } else if(d.type==='SPACE_TOOL_SAVE' && exact(d,['type','version','instance','request','state']) && Number.isSafeInteger(d.request)) {
      try {validateToolSnapshot(d.state);}catch(error){setError(error);send('SPACE_TOOL_SAVED',{request:d.request,error:String(error.message).slice(0,400)});return;}
      const receivedInstance=instance,requestId=d.request;
      saveChain=saveChain.catch(()=>{}).then(async()=>{
        if(disposed || receivedInstance!==instance)return;
        try {saveFeedback.textContent='保存中…';await stateCall('SAVE',{lease,state:d.state});if(receivedInstance!==instance)return;send('SPACE_TOOL_SAVED',{request:requestId});if(d.state.data!==null){saveFeedback.textContent='已保存 · 重开可恢复';}else{saveFeedback.textContent='表单已保存 · 应用尚未保存状态';}}
        catch(error){if(receivedInstance===instance){saveFeedback.textContent='保存失败 · 最近确认的状态仍可恢复';setError(error);send('SPACE_TOOL_SAVED',{request:requestId,error:String(error.message).slice(0,400)});}}
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
  const focusable=()=>[...box.querySelectorAll('button:not(:disabled),textarea:not(:disabled),summary,iframe')].filter(node=>node.getClientRects().length && !node.closest('[hidden]'));
  const onKeyDown=event=>{
    if(!event.isTrusted || disposed)return;
    if(event.key==='Escape'){
      if(!menu.hidden){event.preventDefault();event.stopPropagation();closeMenu(true);}
      else if(!resetReview.hidden){event.preventDefault();event.stopPropagation();resetReview.hidden=true;more.focus({preventScroll:true});}
      else if(box.classList.contains('space-ai-ui-expanded')){event.preventDefault();event.stopPropagation();setExpanded(false);}
      return;
    }
    if(!menu.hidden && menu.contains(event.target) && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();const buttons=[...menu.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);
      const next=event.key==='Home' ? 0 : event.key==='End' ? buttons.length-1 : (index+(event.key==='ArrowDown' ? 1 : -1)+buttons.length)%buttons.length;buttons[next]?.focus();return;
    }
    if(event.key==='Tab' && !menu.hidden && menu.contains(event.target))closeMenu();
    // Child-frame keyboard events do not bubble here. Contain host-side tabbing
    // and focus transitions without claiming control over the opaque document.
    if(event.key==='Tab' && box.classList.contains('space-ai-ui-expanded')){
      const items=focusable(),first=items[0],last=items.at(-1);
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
    }
  };
  const onOutsideClick=event=>{if(event.isTrusted && !menu.hidden && !menuWrap.contains(event.target))closeMenu();};
  const onWindowBlur=()=>{if(!disposed && !menu.hidden && document.activeElement===frame)closeMenu();};
  const onFocus=event=>{
    if(!disposed && box.classList.contains('space-ai-ui-expanded') && !box.contains(event.target))zoom.focus({preventScroll:true});
  };
  document.addEventListener('keydown',onKeyDown);
  document.addEventListener('click',onOutsideClick);
  document.addEventListener('focusin',onFocus);
  window.addEventListener('blur',onWindowBlur);
  const dispose = () => {
    disposed=true;generation++;clearTimeout(watchdog);window.removeEventListener('message',receive);observer.disconnect();
    document.removeEventListener('keydown',onKeyDown);document.removeEventListener('click',onOutsideClick);document.removeEventListener('focusin',onFocus);window.removeEventListener('blur',onWindowBlur);setExpanded(false);
    for(const p of requests.values()){clearTimeout(p.timer);p.reject(new Error('工具已离开当前对话'));}requests.clear();mounts.delete(el);
  };
  const observer=new MutationObserver(()=>{if(!box.isConnected)dispose();});observer.observe(document.body,{childList:true,subtree:true});mounts.set(el,dispose);
  async function open() {
    if(opening || closing || frame || disposed)return;
    opening=true;const currentGeneration=++generation;updateControls();
    saveFeedback.textContent='正在加载工具与保存状态…';
    try {
      const loaded=await stateCall('LOAD');if(disposed || !box.isConnected || currentGeneration!==generation)return;
      lease=loaded.lease;instance=crypto.randomUUID();ready=false;runtimeError='';
      errorFeedback.textContent='';errorFeedback.hidden=true;
      frame=document.createElement('iframe');frame.title='HTML/CSS/JS 隔离工具';frame.dataset.instance=instance;frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';
      frame.src=chrome.runtime.getURL('lib/space-ai-ui/native-host.html');
      const current=frame, currentInstance=instance;
      frame.addEventListener('load',()=>{if(current===frame && !disposed)send('SPACE_TOOL_INIT',{html:parsed.html,state:loaded.state});},{once:true});
      box.insertBefore(frame,resetReview);collapse.textContent='收起';
      watchdog=setTimeout(()=>{if(instance===currentInstance && !ready)setError('工具启动失败；源码或脚本需要修订');},6000);
    } catch(error){setError(error);}
    finally {if(currentGeneration===generation){opening=false;updateControls();}}
  }
  try {sourceHash=await hash(parsed.html);await open();}catch(error){setError(error);}
}

export function mountAiUiPrompt(input,quickbar) {
  if(!quickbar)return;
  const button=document.createElement('button');button.type='button';button.className='space-tool-create';button.textContent='交互工具';button.title='将工具生成约定追加到草稿，确认内容后再发送';
  button.onclick=()=>{if(!input.value.includes(TOOL_PROMPT.trim())){input.value+=TOOL_PROMPT;input.dispatchEvent(new Event('input',{bubbles:true}));}input.focus();};quickbar.append(button);
}
