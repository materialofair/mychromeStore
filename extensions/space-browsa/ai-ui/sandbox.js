// Trusted packaged controller. AI markup never executes JavaScript.
const tags = new Set('div span p h1 h2 h3 h4 ul ol li strong em b i br hr section article header footer main label input button select option textarea form output details summary table thead tbody tr th td pre code canvas'.split(' '));
const styleProps=new Set('color background-color padding margin border border-radius font-size font-weight text-align display gap flex flex-direction flex-wrap align-items justify-content width max-width min-width height max-height overflow white-space box-sizing'.split(' '));
function safeStyle(el, text) {
  const probe=document.createElement('span');probe.style.cssText=text;
  for(const name of probe.style) { const v=probe.style.getPropertyValue(name); if(styleProps.has(name) && v.length<=200 && !/(?:url|var|calc|expression)\s*\(/i.test(v) && !/\d{5}|(?:\d|\.)e[+-]?\d/i.test(v)) el.style.setProperty(name,v); }
}
const attrs = new Set('class style title aria-label placeholder type value min max step name rows cols selected checked disabled hidden data-ui-action data-ui-target'.split(' '));
let rendered = false, instance = '', machine, running, ticks = 0, views = [];
const message = (type, extra = {}) => parent.postMessage({type, version:2, instance, ...extra}, '*');
const stop = () => { clearInterval(running); running=null; };
const notice = document.getElementById('notice');
const target = id => document.getElementById('ui-' + id);
function draw(updates) {
  // Validate every target before applying a successful transaction.
  for (const v of updates) if (!target(v.id) || (v.kind === 'plot' && target(v.id).localName !== 'canvas') || (v.kind === 'text' && !['output','span','p','div','pre'].includes(target(v.id).localName))) throw new Error('Invalid view target');
  for (const v of updates) {
    const el=target(v.id);
    if(v.kind==='text') el.textContent=String(v.value);
    else {
      el.width=600;el.height=240;
      const ctx=el.getContext('2d'); ctx.clearRect(0,0,600,240);
      if(!v.value.length) continue;
      const xs=v.value.map(p=>p[0]),ys=v.value.map(p=>p[1]);
      const loX=Math.min(...xs), hiX=Math.max(...xs), loY=Math.min(...ys), hiY=Math.max(...ys);
      ctx.strokeStyle='#377f68';ctx.lineWidth=2;ctx.beginPath();
      v.value.forEach(([x,y],i)=> { const px=20+(x-loX)/(hiX-loX||1)*560,py=220-(y-loY)/(hiY-loY||1)*200; i ? ctx.lineTo(px,py):ctx.moveTo(px,py); });ctx.stroke();
      ctx.fillStyle='#24312d';ctx.fillText(`${loY.toFixed(2)} … ${hiY.toFixed(2)}`,20,12);
    }
  }
  views=updates;
}
function attempt(fn) { try {draw(fn());notice.textContent=running ? `模拟运行中 ${ticks}/600` : '本地交互；结果仅在你点击回填后进入草稿。';} catch(e) {stop();notice.textContent='运行错误：'+String(e.message).slice(0,160)+'；可重置或让模型修订。';} }
document.getElementById('stop').onclick=()=>{stop();notice.textContent='已停止';};
document.getElementById('step').onclick=()=>{stop();if(machine) attempt(()=>machine.step());};
document.getElementById('reset').onclick=()=>{stop();ticks=0;if(machine) attempt(()=>machine.reset());};
document.getElementById('run').onclick=()=>{
  if (!machine?.hasTick || running) return;
  ticks=0;running=setInterval(()=>{if(++ticks>600){stop();notice.textContent='已达到600步限制；可重置后继续。';return;}attempt(()=>machine.step());},100);
};
window.addEventListener('pagehide',stop);

window.addEventListener('message', event => {
  if (event.source !== parent || !event.data || typeof event.data !== 'object') return;
  const d=event.data;
  if (d.version !== 2 || typeof d.instance !== 'string' || !/^[a-f0-9-]{36}$/.test(d.instance)) return;
  if (d.type === 'SPACE_UI_HELLO' && Object.keys(d).length === 3 && (!instance || instance === d.instance)) {
    instance=d.instance; message('SPACE_UI_READY'); return;
  }
  if (!instance || d.instance !== instance) return;
  if (d.type === 'SPACE_UI_SNAPSHOT' && Object.keys(d).length===4 && typeof d.request==='string' && /^[a-f0-9-]{36}$/.test(d.request)) {
    // Export rendered outputs only. No automatic state or form submission bridge.
    const text=views.map(v=>v.id+': '+(v.kind==='text' ? String(v.value) : `图表 ${v.value.length} 点`)).join('\n').slice(0,4000);
    message('SPACE_UI_RESULT',{request:d.request,text}); return;
  }
  if (rendered || d.type !== 'SPACE_UI_RENDER' || Object.keys(d).length !== 4 || typeof d.html !== 'string' || d.html.length > 64000) return;
  rendered = true;
  const parsed = new DOMParser().parseFromString(event.data.html, 'text/html');
  const programs=parsed.querySelectorAll('script[type="application/space-ui+json"]');
  let count = 0;
  function copy(node, depth = 0) {
    if (++count > 3000 || depth > 40) throw new Error('内容过于复杂');
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE || !tags.has(node.localName)) return null;
    const target = document.createElement(node.localName);
    for (const { name, value } of node.attributes) {
      if(name==='style') {safeStyle(target,value);continue;}
      if (attrs.has(name) && value.length <= 1000 && (name !== 'type' || /^(button|submit|text|number|checkbox|radio|range|email)$/.test(value))) target.setAttribute(name, value);
      if (name === 'id' && /^[a-zA-Z][\w-]{0,63}$/.test(value)) target.id = 'ui-' + value;
    }
    for (const child of node.childNodes) { const clean = copy(child, depth + 1); if (clean) target.append(clean); }
    return target;
  }
  try {
    const fragment = document.createDocumentFragment();
    for (const node of parsed.body.childNodes) { const clean = copy(node); if (clean) fragment.append(clean); }
    if (!fragment.childNodes.length) throw new Error('没有可显示的内容');
    document.getElementById('ui').replaceChildren(fragment);
    if (programs.length > 1) throw new Error('Only one program is supported');
    if (programs.length) {
      machine=createMachine(JSON.parse(programs[0].textContent),id=>{
        const el=target(id); if(!el || !['input','select','textarea'].includes(el.localName)) throw new Error('Invalid input target');
        return el.type==='checkbox' ? el.checked : el.value.slice(0,2000);
      });
      draw(machine.render());
      notice.textContent='本地交互；结果仅在你点击回填后进入草稿。';
      document.getElementById('controls').hidden=false;
      document.getElementById('run').disabled=!machine.hasTick;
      document.getElementById('step').disabled=!machine.hasTick;
      const root=document.getElementById('ui');
      const closest=(el,selector)=>Element.prototype.closest.call(el,selector);
      const localSubmit=(form,submitter=null)=>{
        // allow-forms remains absent: native submission can be blocked before its event.
        // Dispatch one local event ourselves; the submit listener also cancels navigation.
        if(HTMLFormElement.prototype.reportValidity.call(form)) EventTarget.prototype.dispatchEvent.call(form,new SubmitEvent('submit',{bubbles:true,cancelable:true,submitter}));
      };
      for (const eventType of ['click','input','change','submit']) root.addEventListener(eventType,event=>{
        if(eventType==='submit') event.preventDefault();
        const submitter=eventType==='click' ? closest(event.target,'button,input') : null;
        const form=submitter?.type==='submit' ? closest(submitter,'form') : null;
        if(form) event.preventDefault(); // prevents a second browser submission after the local one
        const el=closest(event.target,'[id]');
        if(el && root.contains(el)) attempt(()=>machine.dispatch(Element.prototype.getAttribute.call(el,'id').slice(3),eventType));
        if(form && !submitter.disabled) localSubmit(form,submitter);
      });
      root.addEventListener('keydown',event=>{
        const input=event.target;
        if(event.key!=='Enter' || event.isComposing || input.localName!=='input' || !['text','number','email'].includes(input.type)) return;
        const form=closest(input,'form');if(!form) return;
        event.preventDefault(); // avoid both a synthetic and a native implicit submitter click
        const submitter=Array.from(Element.prototype.querySelectorAll.call(form,'button,input')).find(el=>el.type==='submit');
        if(submitter) {if(!submitter.disabled) HTMLElement.prototype.click.call(submitter);}
        else localSubmit(form);
      });
    }
  } catch(e) {stop(); machine=null; document.getElementById('ui').textContent = 'AI UI 无法运行：'+String(e.message).slice(0,160)+'。请让模型修订后重新打开。';}
});
function showForm(form) {
  // Form control names can shadow instance methods (DOM clobbering).
  const output = Element.prototype.querySelector.call(form, 'output');
  if (output) output.textContent = Array.from(new FormData(form), ([key, value]) => `${key}: ${String(value).slice(0,1000)}`).join('\n');
}
document.addEventListener('click', event => {
  if(machine) return;
  const button = event.target.closest('button[data-ui-action]');
  if (!button) {
    const submit = event.target.closest('button,input');
    const form = submit?.closest('form');
    if (form && submit.type === 'submit') { event.preventDefault(); showForm(form); }
    return;
  }
  // Explicit actions take precedence over a button's implicit submit type.
  event.preventDefault();
  const target = document.getElementById('ui-' + button.dataset.uiTarget);
  if (!target || !document.getElementById('ui').contains(target)) return;
  if (button.dataset.uiAction === 'toggle') target.hidden = !target.hidden;
  if (button.dataset.uiAction === 'increment') {
    const n = Number(target.textContent); target.textContent = String(Number.isFinite(n) ? Math.min(n + 1, 1e9) : 1);
  }
});
document.addEventListener('keydown', event => {
  if(machine) return;
  if (event.key === 'Enter' && event.target.matches('input') && event.target.closest('form')) {
    event.preventDefault(); showForm(event.target.closest('form'));
  }
});
