import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

async function launchTools(prefix:string) {
  const {version}=JSON.parse(await readFile('extensions/space-browsa/upstream.json','utf8'));
  const source=resolve(`.data/packages/space-browsa-${version}`);
  const id=JSON.parse(await readFile('extensions/space-browsa/identity.json','utf8')).extensionId;
  const root=await mkdtemp(join(tmpdir(),prefix));
  const context=await chromium.launchPersistentContext(join(root,'profile'),{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH,args:[`--disable-extensions-except=${source}`,`--load-extension=${source}`]});
  const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  return {context,panel,root};
}

test('trusted result sharing preserves draft and attachment, sends once, and revisions keep the usable tool',async()=>{
  test.setTimeout(90000);
  const calc=await readFile('tests/fixtures/tools/calculator.html','utf8');
  const calls:any[]=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;calls.push(JSON.parse(body));
    const raw=calls.length===1 ? '解释：当前计算结果为5。' : calls.length===3 ? '```space-ui\n<h2>Broken tool</h2><script>throw new Error("Broken revision")</script>\n```' : '```space-ui\n'+calc.replace('result:5','result:7').replace('JS Calculator','Revised calculator')+'\n```';
    res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:raw},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
  const {context,panel,root}=await launchTools('space-tool-share-');
  try {
    await panel.evaluate(({port,calc})=>(window as any).chrome.storage.local.set({history:[{role:'assistant',content:'```space-ui\n'+calc+'\n```'}],providers:{test:{type:'llm',alias:'Local tool provider',baseUrl:`http://localhost:${port}/v1`,apiKey:'fixture-only',model:'fixture',models:['fixture'],apiStyle:'chat',stream:true}},activeProvider:'test',llmsTxtEnabled:false,deepExtractEnabled:false}),{port,calc});
    await panel.reload();await expect(panel.frameLocator('.space-ai-ui > iframe').frameLocator('#tool').locator('#answer')).toHaveText('5');
    const choose=panel.waitForEvent('filechooser');await panel.locator('#space-add-files').click();await (await choose).setFiles({name:'evidence.txt',mimeType:'text/plain',buffer:Buffer.from('AttachmentEvidence991')});
    await expect(panel.locator('[data-space-attachment][data-status=ready]')).toHaveCount(1);
    await panel.locator('#input').fill('DraftEvidence882');
    const box=panel.locator('.space-ai-ui').first();
    const click=async(name:string)=>{const b=box.getByRole('button',{name,exact:true});await b.scrollIntoViewIfNeeded();await b.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));await b.click();};
    await click('把结果发给 AI');await expect(box.locator('.space-tool-review')).toBeVisible();expect(calls).toHaveLength(0);
    await expect(box.locator('.space-tool-review pre')).toContainText('Calculator result: 5');
    await click('发送给 AI');await expect.poll(()=>calls.length).toBe(1);
    await expect(panel.getByText('解释：当前计算结果为5。',{exact:true})).toBeVisible();
    const sent=JSON.stringify(calls[0].messages);expect(sent).toContain('DraftEvidence882');expect(sent).toContain('AttachmentEvidence991');expect(sent).toContain('Calculator result: 5');expect(sent).toContain('spaceTool');
    await expect(panel.locator('[data-space-attachment]')).toHaveCount(0);
    await click('把结果发给 AI');await box.locator('textarea').fill('把默认结果改成7');await click('修改这个工具');
    await expect.poll(()=>calls.length).toBe(2);
    await expect(panel.frameLocator('.space-ai-ui > iframe').nth(1).frameLocator('#tool').locator('#answer')).toHaveText('7');
    await expect(panel.locator('.space-ai-ui').nth(1).locator('.space-tool-version')).toContainText('修改版');
    await panel.locator('.space-ai-ui').nth(1).getByRole('button',{name:'更多工具操作',exact:true}).click();
    await expect(panel.locator('.space-ai-ui').nth(1).getByRole('button',{name:'查看原版',exact:true})).toBeVisible();
    await expect(panel.frameLocator('.space-ai-ui > iframe').nth(0).frameLocator('#tool').locator('#answer')).toHaveText('5');
    await click('把结果发给 AI');await box.locator('textarea').fill('返回错误版本以检查保留旧工具');await click('修改这个工具');
    await expect.poll(()=>calls.length).toBe(3);await expect(panel.locator('.space-ai-ui').nth(2).locator('.space-tool-status')).toContainText('Broken revision');
    await expect(panel.frameLocator('.space-ai-ui > iframe').nth(1).frameLocator('#tool').locator('#answer')).toHaveText('7');
    const identities=await panel.evaluate(async()=>((await (window as any).chrome.storage.local.get('history')).history||[]).filter((x:any)=>x.role==='assistant').map((x:any)=>x.spaceToolMessageId));expect(new Set(identities).size).toBe(identities.length);
  }finally{await context.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});

test('native sandbox blocks parent APIs, resources and navigation, with recoverable restart',async()=>{
  test.setTimeout(60000);
  const requests:string[]=[];const server=createServer((req,res)=>{requests.push(req.url||'');res.end('outside');});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://localhost:${(server.address() as any).port}/outside`;
  const {context,panel,root}=await launchTools('space-tool-boundary-');
  const html=`<!doctype html><style>@import url('${url}?css');div{background-image:url('${url}?background')}</style><h2>Boundary</h2><div>Local</div><img src="${url}?image"><svg><image href="${url}?svg"></image></svg><button id="navigate">Navigate</button><button id="probe">Payload probe</button><script>(async()=>{const p={parent:false,top:false,api:false,storage:false,fetchBlocked:false,popupBlocked:false};try{p.parent=!!parent.document}catch{}try{p.top=!!top.document}catch{}p.api=!!window.chrome?.runtime;try{p.storage=!!localStorage}catch{}try{await fetch(${JSON.stringify(url+'?fetch')})}catch{p.fetchBlocked=true}p.popupBlocked=window.open(${JSON.stringify(url+'?popup')})===null;window.probes=p;spaceTool.setResult({summary:'Boundary probes',data:p});await spaceTool.saveState(p);document.getElementById('navigate').onclick=()=>location.href=${JSON.stringify(url+'?navigation')};document.getElementById('probe').onclick=()=>{const instance=document.head.querySelector('script').textContent.match(/[a-f0-9-]{36}/)[0];parent.postMessage({type:'SPACE_TOOL_SAVE',version:3,instance,request:999,state:{data:Array(10001),forms:{},result:null}},'*');};})();</script>`;
  try {
    await panel.evaluate(html=>(window as any).chrome.storage.local.set({history:[{role:'assistant',content:'```space-ui\n'+html+'\n```'}]}),html);await panel.reload();
    const tool=panel.frameLocator('.space-ai-ui > iframe').frameLocator('#tool');await expect(tool.getByRole('heading',{name:'Boundary'})).toBeVisible();
    const inner=panel.frames().find(f=>f.url()==='about:srcdoc')!;
    await expect.poll(()=>inner.evaluate(()=>(window as any).probes)).toEqual({parent:false,top:false,api:false,storage:false,fetchBlocked:true,popupBlocked:true});
    await tool.locator('#probe').click();await expect(panel.locator('.space-tool-status')).toContainText('arrays');
    await tool.locator('#navigate').click();await expect.poll(()=>inner.url()).not.toBe('about:srcdoc');expect(requests).toEqual([]);
    await panel.getByRole('button',{name:'更多工具操作',exact:true}).click();
    const restart=panel.getByRole('button',{name:'重启',exact:true});await restart.scrollIntoViewIfNeeded();await restart.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));await restart.click();
    await expect(tool.getByRole('heading',{name:'Boundary'})).toBeVisible({timeout:15000});expect(requests).toEqual([]);
  }finally{await context.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});

for(const change of ['detach','context'])test(`confirmation ${change} during async ownership check never sends a result`,async()=>{
  const {context,panel,root}=await launchTools('space-tool-stale-');
  try {
    const html=await readFile('tests/fixtures/tools/calculator.html','utf8');
    await panel.evaluate(async html=>{
      const w=window as any;w.__sendCount=0;w.__context=0;w.__hold=false;w.__release=null;
      w.chrome.runtime.sendMessage=async(msg:any)=>{
        if(msg.type!=='SPACE_TOOL_STATE')return {ok:true,data:{}};
        if(msg.op==='LOAD')return {ok:true,data:{lease:crypto.randomUUID(),state:null}};
        if(msg.op==='PREPARE' && w.__hold) await new Promise<void>(r=>{w.__release=r;});
        return {ok:true,data:{history:[{spaceToolMessageId:'00000000-0000-0000-0000-000000000001'}]}};
      };
      const module=await import(w.chrome.runtime.getURL('lib/space-ai-ui/panel.js'));
      const holder=document.createElement('div');holder.id='stale-holder';document.body.prepend(holder);
      await module.mountAiUi(holder,'```space-ui\n'+html+'\n```',{spaceToolMessageId:'00000000-0000-0000-0000-000000000001'},{sendResult:()=>{w.__sendCount++;},captureContext:()=>{const v=w.__context;return ()=>v===w.__context;}});
    },html);
    const holder=panel.locator('#stale-holder');await expect(holder.frameLocator('iframe').frameLocator('#tool').locator('#answer')).toHaveText('5');
    const click=async(name:string)=>{const b=holder.getByRole('button',{name,exact:true});await b.scrollIntoViewIfNeeded();await b.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));await b.click();};
    await click('把结果发给 AI');await expect(holder.locator('.space-tool-review')).toBeVisible();
    await panel.evaluate(()=>(window as any).__hold=true);await click('发送给 AI');
    await expect.poll(()=>panel.evaluate(()=>!!(window as any).__release)).toBe(true);
    await panel.evaluate(change=>{const w=window as any;if(change==='context')w.__context++;else document.getElementById('stale-holder')!.remove();w.__release();},change);
    await panel.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
    expect(await panel.evaluate(()=>(window as any).__sendCount)).toBe(0);
  }finally{await context.close();await rm(root,{recursive:true,force:true});}
});

test('late context change in tab lookup is not reported as a successful model submission',async()=>{
  test.setTimeout(60000);
  let calls=0;const server=createServer(async(req,res)=>{for await(const _ of req){}calls++;res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: [DONE]\n\n');});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const port=(server.address() as any).port;
  const {context,panel,root}=await launchTools('space-tool-late-context-');
  try{
    const html=await readFile('tests/fixtures/tools/calculator.html','utf8');
    await panel.evaluate(({html,port})=>(window as any).chrome.storage.local.set({history:[{role:'assistant',content:'```space-ui\n'+html+'\n```'}],providers:{test:{type:'llm',baseUrl:`http://localhost:${port}/v1`,apiKey:'fixture-only',model:'fixture',models:['fixture'],apiStyle:'chat',stream:true}},activeProvider:'test'}),{html,port});await panel.reload();
    await expect(panel.frameLocator('.space-ai-ui > iframe').frameLocator('#tool').locator('#answer')).toHaveText('5');
    await panel.evaluate(()=>{const w=window as any;const get=w.chrome.tabs.get.bind(w.chrome.tabs);w.__releaseTab=null;w.chrome.tabs.get=async(id:number)=>{const tab=await get(id);await new Promise<void>(r=>w.__releaseTab=r);return tab;};});
    const box=panel.locator('.space-ai-ui');const click=async(name:string)=>{const b=box.getByRole('button',{name,exact:true});await b.scrollIntoViewIfNeeded();await b.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));await b.click();};
    await click('把结果发给 AI');await expect(box.locator('.space-tool-review')).toBeVisible();await click('发送给 AI');
    await expect.poll(()=>panel.evaluate(()=>!!(window as any).__releaseTab)).toBe(true);
    await panel.evaluate(async()=>{await (window as any).chrome.storage.local.set({history:[]});});
    await panel.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
    await panel.evaluate(()=>(window as any).__releaseTab());
    await expect(box.locator('.space-tool-status')).toContainText('未提交');
    await expect(box.locator('.space-tool-review')).toBeVisible();expect(calls).toBe(0);
  }finally{await context.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});

test('two reopen clicks during a delayed load create one controlled frame',async()=>{
  const {context,panel,root}=await launchTools('space-tool-reopen-');
  try{
    const html=await readFile('tests/fixtures/tools/calculator.html','utf8');await panel.evaluate(html=>(window as any).chrome.storage.local.set({history:[{role:'assistant',content:'```space-ui\n'+html+'\n```'}]}),html);await panel.reload();
    const box=panel.locator('.space-ai-ui');await expect(box.frameLocator('iframe').frameLocator('#tool').locator('#answer')).toHaveText('5');
    const collapse=box.getByRole('button',{name:'收起',exact:true});await collapse.scrollIntoViewIfNeeded();await collapse.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));await collapse.click();await expect(box.locator('iframe')).toHaveCount(0);
    await panel.evaluate(()=>{const w=window as any;w.__loads=0;const original=w.chrome.runtime.sendMessage.bind(w.chrome.runtime);w.chrome.runtime.sendMessage=async(m:any)=>{const result=await original(m);if(m.type==='SPACE_TOOL_STATE' && m.op==='LOAD'){w.__loads++;await new Promise(r=>setTimeout(r,400));}return result;};});
    const reopen=box.getByRole('button',{name:'重新打开',exact:true});await reopen.scrollIntoViewIfNeeded();const b=(await reopen.boundingBox())!;
    await panel.mouse.click(b.x+b.width/2,b.y+b.height/2);await panel.mouse.click(b.x+b.width/2,b.y+b.height/2);
    await expect(box.locator('iframe')).toHaveCount(1);expect(await panel.evaluate(()=>(window as any).__loads)).toBe(1);
    await expect(box.frameLocator('iframe').frameLocator('#tool').locator('#answer')).toHaveText('5');
  }finally{await context.close();await rm(root,{recursive:true,force:true});}
});

test('a successful autosave does not hide an uncaught script error',async()=>{
  const {context,panel,root}=await launchTools('space-tool-error-');
  try{
    const html=(await readFile('tests/fixtures/tools/calculator.html','utf8')).replace('</body>','<script>throw new Error("RuntimeBoom")</script></body>');
    await panel.evaluate(html=>(window as any).chrome.storage.local.set({history:[{role:'assistant',content:'```space-ui\n'+html+'\n```'}]}),html);await panel.reload();
    await expect(panel.frameLocator('.space-ai-ui > iframe').frameLocator('#tool').locator('#answer')).toHaveText('5');
    await expect(panel.locator('.space-tool-status')).toContainText('RuntimeBoom');
    await expect(panel.locator('.space-tool-status')).toContainText('已保存');
    await expect(panel.locator('.space-tool-status')).toContainText('RuntimeBoom');
  }finally{await context.close();await rm(root,{recursive:true,force:true});}
});
