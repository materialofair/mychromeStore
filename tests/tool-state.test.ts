import { describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
// @ts-expect-error JS recipe
import { createToolStateStore, isTrustedToolSender, validateToolSnapshot } from '../extensions/space-browsa/ai-ui/tool-state.mjs';
// @ts-expect-error JS recipe
import { applyToolStatePatch } from '../extensions/space-browsa/tool-state-patch.mjs';
const html='<input name="value">';
const content='```space-ui\n'+html+'\n```';
const sourceHash=createHash('sha256').update(html).digest('hex');
const assistant=(id?:string)=>({role:'assistant',content,...(id?{spaceToolMessageId:id}:{})});
function fixture(initial:Record<string,unknown>={}) {
  const db:Record<string,any>=structuredClone(initial); const reads:string[][]=[];
  const storage={get:async(keys:string[])=>{reads.push(keys); return structuredClone(Object.fromEntries(keys.filter(k=>k in db).map(k=>[k,db[k]])));},set:async(values:object)=>{Object.assign(db,structuredClone(values));}};
  return {db,storage,reads,store:createToolStateStore(storage)};
}
const snapshot={data:{count:3},forms:{value:'42'},result:{summary:'Done',data:[1,2]}};
const request=(op:string,messageId:string,extra:object={})=>({op,messageId,sourceHash,...extra});
describe('privileged tool state store',()=>{
  it('migrates current and saved histories with stable distinct IDs, retaining active archived identity',async()=>{
    const savedId=randomUUID(); const second={...assistant(),content:'Distinct second reply'}; const f=fixture({history:[assistant(),second],activeSessionId:'active',savedSessions:[{id:'active',history:[assistant(savedId),second]},{id:'other',history:[assistant()]}]});
    const first=await f.store.handle({op:'PREPARE'}); const ids=first.history.map((m:any)=>m.spaceToolMessageId);
    expect(ids[0]).toBe(savedId); expect(new Set(ids).size).toBe(2);
    expect(f.db.savedSessions[0].history.map((m:any)=>m.spaceToolMessageId)).toEqual(ids);
    expect(f.db.savedSessions[1].history[0].spaceToolMessageId).not.toBe(ids[0]);
    expect((await f.store.handle({op:'PREPARE'})).history).toEqual(first.history);
    expect(f.reads.flat()).not.toContain('apiKey');
  });
  it('does not alias ambiguous repeated legacy messages to an archived tool',async()=>{
    const a=randomUUID(),b=randomUUID();
    const f=fixture({history:[assistant()],activeSessionId:'active',savedSessions:[{id:'active',history:[assistant(a),assistant(b)]}]});
    const id=(await f.store.handle({op:'PREPARE'})).history[0].spaceToolMessageId;
    expect(id).not.toBe(a); expect(id).not.toBe(b);
  });
  it('does not rank longer repeated turns above the true trimmed suffix',async()=>{
    const a=randomUUID(),b=randomUUID(); const question={role:'user',content:'Repeated question'};
    const f=fixture({history:[question,assistant(),question],activeSessionId:'active',savedSessions:[{id:'active',history:[question,assistant(a),question,assistant(b)]}]});
    const id=(await f.store.handle({op:'PREPARE'})).history[1].spaceToolMessageId;
    expect(id).not.toBe(a); expect(id).not.toBe(b);
    expect(f.db.savedSessions[0].history[1].spaceToolMessageId).toBe(a);
    expect(f.db.savedSessions[0].history[3].spaceToolMessageId).toBe(b);
  });
  it('uses existing neighboring UUIDs as ordered evidence when repeated legacy text is ambiguous',async()=>{
    const a=randomUUID(),b=randomUUID(),neighbor=randomUUID(); const next={...assistant(neighbor),content:'Neighbor'};
    const f=fixture({history:[assistant(),next],activeSessionId:'active',savedSessions:[{id:'active',history:[assistant(a),{...assistant(),content:'Different'},assistant(b),next]}]});
    expect((await f.store.handle({op:'PREPARE'})).history[0].spaceToolMessageId).toBe(b);
  });
  it('shares migration locking with concurrent upstream append and saved-session mutations',async()=>{
    const f=fixture({history:[assistant()],savedSessions:[]}); let chain=Promise.resolve(); let append:Promise<unknown>|undefined;
    const withHistoryLock=(fn:()=>Promise<any>)=>{const next=chain.then(fn,fn); chain=next.then(()=>{},()=>{}); return next;};
    const originalGet=f.storage.get; let triggered=false;
    f.storage.get=async(keys:string[])=>{
      const captured=await originalGet(keys);
      if(!triggered) {triggered=true; append=withHistoryLock(async()=>{f.db.history.push({role:'user',content:'Concurrent append'}); f.db.savedSessions.push({id:'new',history:[]});});}
      return captured;
    };
    const store=createToolStateStore(f.storage,{withHistoryLock});
    await store.handle({op:'PREPARE'}); await append;
    expect(f.db.history.map((m:any)=>m.content)).toEqual([content,'Concurrent append']);
    expect(f.db.savedSessions.map((s:any)=>s.id)).toEqual(['new']);
  });
  it('retains active archived UUIDs after history auto-trims the conversation prefix',async()=>{
    const id=randomUUID(); const question={role:'user',content:'Latest question'};
    const f=fixture({history:[question,assistant()],activeSessionId:'active',savedSessions:[{id:'active',history:[{role:'user',content:'Old question'},{role:'assistant',content:'Old reply'},question,assistant(id)]}]});
    const prepared=await f.store.handle({op:'PREPARE'});
    expect(prepared.history[1].spaceToolMessageId).toBe(id);
  });
  it('persists by message identity across restarts and archive reopen, not source equality',async()=>{
    const id=randomUUID(),other=randomUUID(); const f=fixture({history:[assistant(id),assistant(other)],savedSessions:[]});
    const loaded=await f.store.handle(request('LOAD',id)); expect(loaded.state).toBeNull();
    await f.store.handle(request('SAVE',id,{lease:loaded.lease,state:snapshot}));
    expect((await f.store.handle(request('LOAD',other))).state).toBeNull();
    f.db.savedSessions=[{id:'a',history:f.db.history}]; f.db.history=[]; await f.store.gc();
    f.db.history=f.db.savedSessions[0].history;
    const restarted=createToolStateStore(f.storage);
    expect((await restarted.handle(request('LOAD',id))).state).toEqual(snapshot);
  });
  it('writes schema 1 envelopes and migrates legacy records without changing the state API',async()=>{
    const id=randomUUID(); const lease=randomUUID();
    const f=fixture({history:[assistant(id)],spaceToolStateV1:{[id]:{sourceHash,lease,state:snapshot}}});
    const loaded=await f.store.handle(request('LOAD',id));
    expect(loaded.state).toEqual(snapshot); expect(Object.keys(loaded).sort()).toEqual(['lease','state']);
    expect(f.db.spaceToolStateV1[id].stateSchemaVersion).toBe(1);
    await f.store.handle(request('SAVE',id,{lease:loaded.lease,state:snapshot}));
    expect(f.db.spaceToolStateV1[id].stateSchemaVersion).toBe(1);
    await f.store.handle(request('RESET',id,{lease:loaded.lease}));
    expect(f.db.spaceToolStateV1[id]).toMatchObject({stateSchemaVersion:1,state:null});
    for(const version of [2,0,null,'1']) {
      f.db.spaceToolStateV1[id]={stateSchemaVersion:version,sourceHash,lease,state:snapshot};
      await expect(f.store.handle(request('LOAD',id))).rejects.toThrow('版本');
      expect(f.db.spaceToolStateV1[id].stateSchemaVersion).toBe(version);
    }
  });
  it('applies snapshot bounds while migrating a legacy envelope',async()=>{
    const id=randomUUID(); const f=fixture({history:[assistant(id)],spaceToolStateV1:{[id]:{sourceHash,lease:randomUUID(),state:{...snapshot,data:'x'.repeat(65537)}}}});
    await expect(f.store.handle(request('LOAD',id))).rejects.toThrow('限制');
    expect(f.db.spaceToolStateV1[id].stateSchemaVersion).toBeUndefined();
  });
  it('authorizes exact sidepanel origin and own extension ID only',()=>{
    const runtime={id:'abc',getURL:(p:string)=>'chrome-extension://abc/'+p};
    expect(isTrustedToolSender({id:'abc',url:runtime.getURL('sidepanel.html')},runtime)).toBe(true);
    for(const sender of [{id:'xyz',url:runtime.getURL('sidepanel.html')},{id:'abc',url:runtime.getURL('sidepanel.html')+'?x'},{id:'abc',url:runtime.getURL('options.html')},{id:'abc',url:'https://evil/sidepanel.html'},{}]) expect(isTrustedToolSender(sender,runtime)).toBe(false);
  });
  it('rejects forged identity/hash, blocked and non-tool messages, and stale leases on save/reset',async()=>{
    const id=randomUUID(); const f=fixture({history:[assistant(id)]});
    await expect(f.store.handle({...request('LOAD',id),sourceHash:'0'.repeat(64)})).rejects.toThrow('来源');
    await expect(f.store.handle(request('LOAD',randomUUID()))).rejects.toThrow('消息');
    const a=await f.store.handle(request('LOAD',id)); const b=await f.store.handle(request('LOAD',id));
    for(const op of ['SAVE','RESET']) await expect(f.store.handle(request(op,id,{lease:a.lease,state:snapshot}))).rejects.toThrow('过期');
    await f.store.handle(request('SAVE',id,{lease:b.lease,state:snapshot}));
    expect(await f.store.handle(request('RESET',id,{lease:b.lease}))).toEqual({state:null});
    for(const entry of [{...assistant(id),outputTruncated:true},{...assistant(id),interrupted:true},{...assistant(id),content:'plain'}]) {f.db.history=[entry]; await expect(f.store.handle(request('LOAD',id))).rejects.toThrow('消息');}
  });
  it('serializes concurrent updates and collects only unreferenced messages',async()=>{
    const id=randomUUID(),other=randomUUID(); const f=fixture({history:[assistant(id),assistant(other)]});
    const a=await f.store.handle(request('LOAD',id)),b=await f.store.handle(request('LOAD',other));
    await Promise.all([f.store.handle(request('SAVE',id,{lease:a.lease,state:snapshot})),f.store.handle(request('SAVE',other,{lease:b.lease,state:{...snapshot,data:99}}))]);
    f.db.savedSessions=[{id:'s',history:[assistant(id)]}]; f.db.history=[]; await f.store.gc();
    expect(Object.keys(f.db.spaceToolStateV1)).toEqual([id]);
    f.db.savedSessions=[]; await f.store.gc(); expect(f.db.spaceToolStateV1).toEqual({});
  });
  it('rejects unsafe or excessive snapshots and reports total quota without evicting prior state',async()=>{
    const customArray:any[] = [1]; Object.setPrototypeOf(customArray, Object.create(Array.prototype));
    const symbolArray:any[] = [1]; Object.defineProperty(symbolArray, Symbol('extra'), {value:2});
    const invalid=[{...snapshot,data:customArray},{...snapshot,data:symbolArray},{...snapshot,data:Infinity},{...snapshot,data:new Date()}, {...snapshot,data:JSON.parse('{"__proto__":{"x":1}}')}, {...snapshot,forms:[]},{...snapshot,result:{summary:'x',data:undefined}}, {...snapshot,data:'x'.repeat(65537)}, {...snapshot,data:{constructor:'bad'}}, {...snapshot,data:{a:{b:{c:{d:{e:{f:{g:{h:{i:{j:{k:{l:{m:{n:{o:{p:{q:1}}}}}}}}}}}}}}}}}}];
    for(const state of invalid) expect(()=>validateToolSnapshot(state)).toThrow();
    expect(()=>validateToolSnapshot({...snapshot,data:Array.from({length:3},()=> 'x'.repeat(60000))})).toThrow('128');
    const id=randomUUID(); const f=fixture({history:[assistant(id)]}); const tiny=createToolStateStore(f.storage,{maxTotalBytes:500});
    const load=await tiny.handle(request('LOAD',id));
    await expect(tiny.handle(request('SAVE',id,{lease:load.lease,state:{...snapshot,data:'x'.repeat(1000)}}))).rejects.toThrow('配额');
    expect((await tiny.handle(request('LOAD',id))).state).toBeNull();
  });
});
it('patches the pinned source with strict anchors and returns the persisted identity on DONE',async()=>{
  const work=await mkdtemp(join(tmpdir(),'space-tool-state-'));
  try {
    for(const file of ['background.js','lib/storage.js','lib/handlers/chat-handler.js']) {await mkdir(join(work,file,'..'),{recursive:true}); await writeFile(join(work,file),execFileSync('git',['show','7f6df4b8712a40214a358c34483982b7e774f4b8:'+file],{cwd:'.data/browsa-upstream'}));}
    // Apply the preceding AI UI truncation change exactly as the build pipeline does.
    const handlerPath=join(work,'lib/handlers/chat-handler.js'); let handler=await readFile(handlerPath,'utf8');
    handler=handler.replace("await persistTurnEntry(tabId, { role: 'assistant', content: fullReply, providerLabel, providerKey, ...(videoSrc ? { videoSrc } : {}) });","await persistTurnEntry(tabId, { role: 'assistant', content: fullReply, providerLabel, providerKey, ...(replyTruncated ? { outputTruncated: true } : {}), ...(videoSrc ? { videoSrc } : {}) });"); await writeFile(handlerPath,handler);
    await applyToolStatePatch(work);
    expect(await readFile(handlerPath,'utf8')).toContain('spaceToolMessageId: completedEntry.spaceToolMessageId');
    expect(await readFile(handlerPath,'utf8')).toContain('if (saved) return entry;');
    const patchedStorage=await readFile(join(work,'lib/storage.js'),'utf8');
    expect(patchedStorage).toContain('message.spaceToolMessageId ||= crypto.randomUUID()');
    expect(patchedStorage).toContain('export function withHistoryLock(fn)');
    for(const name of ['saveCurrentSession','appendToSessionHistory','updateSessionHistory','pinSession','loadSession','deleteSession','renameSession','clearAllSessions','setActiveSessionId']) expect(patchedStorage).toContain('return withHistoryLock(() => _spaceUnlocked_'+name+'(');
    expect(await readFile(join(work,'lib/space-ai-ui/tool-state-background.js'),'utf8')).toContain('withHistoryLock');
    expect(await readFile(join(work,'lib/space-ai-ui/tool-state.js'),'utf8')).toContain("from './protocol.js'");
    const database:Record<string,any>={history:[assistant()],savedSessions:[{id:'old',history:[assistant()]}]};
    let api:any; let append:Promise<unknown>|undefined; let archived:Promise<unknown>|undefined; let captured=false;
    const local={get:async(input:string|string[])=>{
      const keys=typeof input==='string'?[input]:input;
      const values=structuredClone(Object.fromEntries(keys.filter(k=>k in database).map(k=>[k,database[k]])));
      if(Array.isArray(input) && input.includes('spaceToolStateV1') && !captured) {
        captured=true; append=api.appendToHistory({role:'user',content:'Actual patched append'});
        archived=api.renameSession('old','Concurrent rename');
      }
      return values;
    },set:async(values:any)=>{Object.assign(database,structuredClone(values));}};
    const context:any={chrome:{storage:{local}},crypto:{randomUUID},PAGE_CONTEXT_PREFIX:'PAGE',ASR_PROVIDERS:{},BRIDGE_CARD_LABEL:'Bridge'};
    runInNewContext(patchedStorage.replace(/^import .*;\n/gm,'').replaceAll('export ','')+'\nglobalThis.spaceStorage={withHistoryLock,appendToHistory,renameSession,loadSession,saveCurrentSession};',context);
    api=context.spaceStorage;
    await createToolStateStore(local,{withHistoryLock:api.withHistoryLock}).handle({op:'PREPARE'});
    await Promise.all([append,archived]);
    expect(database.history.map((m:any)=>m.content)).toEqual([content,'Actual patched append']);
    expect(database.savedSessions[0].name).toBe('Concurrent rename');
    await api.loadSession('old');
    expect(database.history[0].spaceToolMessageId).toBe(database.savedSessions[0].history[0].spaceToolMessageId);
    delete database.history[0].spaceToolMessageId;
    const saved=await api.saveCurrentSession('Saved');
    expect(database.history[0].spaceToolMessageId).toBe(saved.history[0].spaceToolMessageId);
    expect(saved.history[0].spaceToolMessageId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(applyToolStatePatch(work)).rejects.toThrow('anchor');
  } finally {await rm(work,{recursive:true,force:true});}
});

it('background listener owns only tool messages, rejects unauthorized senders and sanitizes errors',async()=>{
  let listener:any; let changes:any; const requests:any[]=[]; let failure:Error|undefined;
  const fakeRuntime={id:'abc',getURL:(p:string)=>'chrome-extension://abc/'+p,onMessage:{addListener:(fn:any)=>{listener=fn;}}};
  let collected=0;
  const fakeStore={handle:async(message:any)=>{requests.push(message); if(failure)throw failure; return {state:null};},gc:async()=>{collected++;}};
  const code=(await readFile('extensions/space-browsa/ai-ui/tool-state-background.js','utf8')).replace(/^import .*;\n/gm, '');
  runInNewContext(code,{chrome:{runtime:fakeRuntime,storage:{local:{},onChanged:{addListener:(fn:any)=>{changes=fn;}}}},createToolStateStore:()=>fakeStore,withHistoryLock:(fn:any)=>fn(),isTrustedToolSender,ToolStateError:class ToolStateError extends Error {}});
  const replies:any[]=[]; const reply=(v:any)=>replies.push(v);
  expect(listener({type:'OTHER'},{},reply)).toBeUndefined(); expect(replies).toEqual([]);
  listener({type:'SPACE_TOOL_STATE'}, {id:'abc',url:fakeRuntime.getURL('options.html')},reply);
  expect(replies[0].ok).toBe(false); expect(requests).toEqual([]);
  expect(listener({type:'SPACE_TOOL_STATE',op:'LOAD'},{id:'abc',url:fakeRuntime.getURL('sidepanel.html')},reply)).toBe(true);
  await Promise.resolve(); expect(replies[1]).toEqual({ok:true,data:{state:null}});
  failure=new Error('SENSITIVE STORAGE DETAIL'); listener({type:'SPACE_TOOL_STATE'}, {id:'abc',url:fakeRuntime.getURL('sidepanel.html')},reply);
  await Promise.resolve(); await Promise.resolve(); expect(JSON.stringify(replies)).not.toContain('SENSITIVE');
  changes({apiKey:{}},'local'); changes({history:{}},'sync'); expect(collected).toBe(0);
  changes({history:{}},'local'); changes({savedSessions:{}},'local'); expect(collected).toBe(2);
});
