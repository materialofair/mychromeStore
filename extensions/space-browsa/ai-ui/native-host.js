// This controller shares neither its DOM nor globals with generated scripts.
const tool = document.getElementById('tool');
let instance = '', rendered = false, saving = null, windowStart = 0, saves = 0;
const fields = (d, names) => d && typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length === names.length && names.every(k => Object.hasOwn(d, k));
const outer = (type, extra = {}) => parent.postMessage({ type, version: 3, instance, ...extra }, '*');
window.addEventListener('message', e => {
  const d = e.data;
  if (!d || typeof d !== 'object' || d.version !== 3 || typeof d.instance !== 'string' || !/^[a-f0-9-]{36}$/.test(d.instance)) return;
  if (e.source === parent) {
    if (d.type === 'SPACE_TOOL_INIT' && !rendered && fields(d, ['type','version','instance','html','state']) && typeof d.html === 'string' && d.html.length <= 64000) {
      instance = d.instance; rendered = true;
      try { tool.srcdoc = buildToolDocument(d.html, d.state, instance); }
      catch (error) { outer('SPACE_TOOL_ERROR', { error: String(error.message).slice(0,400) }); }
    } else if (d.instance === instance && rendered) {
      if (d.type === 'SPACE_TOOL_PAUSE' && fields(d,['type','version','instance'])) tool.contentWindow.postMessage(d,'*');
      if (d.type === 'SPACE_TOOL_SNAPSHOT' && fields(d,['type','version','instance','request']) && typeof d.request === 'string') tool.contentWindow.postMessage(d,'*');
      if (d.type === 'SPACE_TOOL_CLOSE' && fields(d,['type','version','instance','request']) && typeof d.request === 'string') tool.contentWindow.postMessage(d,'*');
      if (d.type === 'SPACE_TOOL_SAVED' && (fields(d,['type','version','instance','request']) || fields(d,['type','version','instance','request','error'])) && Number.isSafeInteger(d.request) && d.request===saving) {saving=null;tool.contentWindow.postMessage(d,'*');}
    }
  } else if (e.source === tool.contentWindow && e.origin === 'null' && d.instance === instance && rendered) {
    if (d.type === 'SPACE_TOOL_READY' && fields(d,['type','version','instance'])) outer(d.type);
    if (d.type === 'SPACE_TOOL_SAVE' && fields(d,['type','version','instance','request','state']) && Number.isSafeInteger(d.request) && d.request>0) {
      try {
        const now=performance.now();if(now-windowStart>1000){windowStart=now;saves=0;}
        if(saving!==null || ++saves>20)throw new Error('Too many state saves; wait for confirmation');
        const state=validateToolPayload(d.state);saving=d.request;outer(d.type,{request:d.request,state});
      } catch(error) {tool.contentWindow.postMessage({type:'SPACE_TOOL_SAVED',version:3,instance,request:d.request,error:String(error.message).slice(0,400)},'*');outer('SPACE_TOOL_ERROR',{error:String(error.message).slice(0,400)});}
    }
    if (d.type === 'SPACE_TOOL_RESULT' && fields(d,['type','version','instance','request','result']) && typeof d.request === 'string') {
      try {outer(d.type,{request:d.request,result:validateToolPayload(d.result,12000)});}
      catch(error){outer('SPACE_TOOL_ERROR',{error:String(error.message).slice(0,400)});}
    }
    if (d.type === 'SPACE_TOOL_CLOSED' && fields(d,['type','version','instance','request']) && typeof d.request === 'string') outer(d.type,{request:d.request});
    if (d.type === 'SPACE_TOOL_ERROR' && fields(d,['type','version','instance','error']) && typeof d.error === 'string') outer(d.type,{error:d.error.slice(0,400)});
  }
});
