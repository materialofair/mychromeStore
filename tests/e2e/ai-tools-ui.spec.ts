import { test, expect, chromium } from '@playwright/test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

async function launchUI() {
  const {version}=JSON.parse(await readFile('extensions/space-browsa/upstream.json','utf8'));
  const source=resolve(`.data/packages/space-browsa-${version}`);
  const id=JSON.parse(await readFile('extensions/space-browsa/identity.json','utf8')).extensionId;
  const root=await mkdtemp(join(tmpdir(),'space-tool-ui-'));
  const context=await chromium.launchPersistentContext(join(root,'profile'),{headless:true,executablePath:process.env.CHROMIUM_PATH,viewport:{width:1000,height:900},args:[`--disable-extensions-except=${source}`,`--load-extension=${source}`]});
  const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  const html=(await readFile('tests/fixtures/tools/calculator.html','utf8')).replace('<head>','<head><title>测试计算器</title>');
  await panel.evaluate(html=>(window as any).chrome.storage.local.set({history:[{role:'assistant',content:'```space-ui\n'+html+'\n```'},{role:'assistant',content:'继续操作上方工具。'}]}),html);await panel.reload();
  const box=panel.locator('.space-ai-ui');const tool=box.frameLocator('iframe').frameLocator('#tool');await expect(tool.locator('#answer')).toHaveText('5');
  const clickLocator=async(b:any)=>{await b.scrollIntoViewIfNeeded();await b.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));await b.click();};
  const click=async(name:string)=>clickLocator(box.getByRole('button',{name,exact:true}));
  const more=async()=>{await click('更多工具操作');};
  return {context,panel,box,tool,root,click,clickLocator,more};
}

test('tool card exposes title, groups actions, confirms reset and restores focus without replacing the frame',async()=>{
  const {context,panel,box,tool,root,click,clickLocator,more}=await launchUI();
  try{
    await expect(box.getByRole('heading',{name:'测试计算器',exact:true})).toBeVisible();
    await expect(box.getByRole('button',{name:'重置工具',exact:true})).toBeHidden();
    await tool.locator('#a').fill('8');await tool.locator('#b').fill('2');await tool.locator('#multiply').click();await expect(tool.locator('#answer')).toHaveText('16');
    const instance=await box.locator('iframe').getAttribute('data-instance');
    await click('放大');await expect(box).toHaveClass(/space-ai-ui-expanded/);expect(await box.locator('iframe').getAttribute('data-instance')).toBe(instance);
    const expanded=await box.boundingBox(),viewport=panel.viewportSize()!;expect(expanded!.x).toBe(12);expect(expanded!.y).toBe(12);expect(expanded!.width).toBe(viewport.width-24);expect(expanded!.height).toBe(viewport.height-24);
    await panel.screenshot({path:'test-results/ai-tools-ui-expanded.png'});
    await panel.keyboard.press('Escape');await expect(box).not.toHaveClass(/space-ai-ui-expanded/);await expect(box.getByRole('button',{name:'放大',exact:true})).toBeFocused();
    await more();await expect(box.getByRole('button',{name:'重置工具',exact:true})).toBeVisible();await panel.keyboard.press('Escape');await expect(box.getByRole('button',{name:'更多工具操作',exact:true})).toBeFocused();
    await more();await tool.locator('#a').click();await expect(box.getByRole('button',{name:'重置工具',exact:true})).toBeHidden();
    await more();await click('重置工具');await expect(box.locator('.space-tool-reset')).toBeVisible();await expect(tool.locator('#answer')).toHaveText('16');
    await clickLocator(box.locator('.space-tool-reset').getByRole('button',{name:'取消',exact:true}));await expect(tool.locator('#answer')).toHaveText('16');
    await more();await click('重置工具');const oldInstance=await box.locator('iframe').getAttribute('data-instance');await expect(box.locator('.space-tool-reset').getByRole('button',{name:'确认重置',exact:true})).toBeFocused();await panel.keyboard.press('Enter');await expect(box.locator('iframe')).not.toHaveAttribute('data-instance',oldInstance!);await expect(tool.locator('#answer')).toHaveText('5');await expect(box.getByRole('button',{name:'收起',exact:true})).toBeFocused();
    await tool.locator('#a').fill('8');await tool.locator('#b').fill('2');await tool.locator('#multiply').click();await expect(tool.locator('#answer')).toHaveText('16');
    await click('收起');await expect(box.locator('iframe')).toHaveCount(0);
    await more();await click('重置工具');await clickLocator(box.locator('.space-tool-reset').getByRole('button',{name:'确认重置',exact:true}));await expect(tool.locator('#answer')).toHaveText('5');
  }finally{await context.close();await rm(root,{recursive:true,force:true});}
});

test('sharing shows a semantic summary before raw data and narrow dark/light sidebars remain usable',async()=>{
  const {context,panel,box,root,click,clickLocator}=await launchUI();
  try{
    await click('把结果发给 AI');await expect(box.locator('.space-tool-review')).toBeVisible();await expect(box.locator('.space-tool-result-summary')).toContainText('Calculator result: 5');
    await expect(box.locator('.space-tool-review pre')).toBeHidden();await clickLocator(box.locator('.space-tool-review details summary'));await expect(box.locator('.space-tool-review pre')).toBeVisible();
    await expect(box.locator('textarea')).toHaveAttribute('aria-label','工具结果提问');
    await clickLocator(box.locator('.space-tool-review').getByRole('button',{name:'取消',exact:true}));await expect(box.locator('.space-tool-review')).toBeHidden();
    for(const colorScheme of ['dark','light'] as const)for(const viewportWidth of [420,360]){await panel.emulateMedia({colorScheme});await panel.setViewportSize({width:viewportWidth,height:900});await box.scrollIntoViewIfNeeded();const width=await panel.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));expect(width.scroll).toBeLessThanOrEqual(width.viewport);await expect(box.getByRole('button',{name:'更多工具操作',exact:true})).toBeVisible();await panel.screenshot({path:`test-results/ai-tools-ui-${colorScheme}-${viewportWidth}.png`,animations:'disabled'});}
    const create=panel.getByRole('button',{name:'交互工具',exact:true});await panel.locator('#input').fill('保留我的原始问题');await create.click();const once=await panel.locator('#input').inputValue();await create.click();expect(await panel.locator('#input').inputValue()).toBe(once);expect(once).toContain('保留我的原始问题');
  }finally{await context.close();await rm(root,{recursive:true,force:true});}
});

test('reset keeps the running tool and confirmation focus when the final save fails',async()=>{
  const {context,panel,box,root,click,more}=await launchUI();
  try{
    await expect(box.locator('.space-tool-status')).toContainText('已保存');
    const instance=await box.locator('iframe').getAttribute('data-instance');
    await panel.evaluate(()=>{
      const runtime=(window as any).chrome.runtime,send=runtime.sendMessage.bind(runtime);
      (window as any).resetRequests=0;
      runtime.sendMessage=(m:any,...args:any[])=>{
        if(m?.type==='SPACE_TOOL_STATE' && m.op==='RESET')(window as any).resetRequests++;
        if(m?.type==='SPACE_TOOL_STATE' && m.op==='SAVE')return Promise.resolve({ok:false,error:'Fixture final save refused'});
        return send(m,...args);
      };
    });
    await more();await click('重置工具');await panel.keyboard.press('Enter');
    await expect(box.locator('.space-tool-error')).toContainText('Fixture final save refused');
    await expect(box.locator('.space-tool-reset')).toBeVisible();
    await expect(box.locator('.space-tool-reset').getByRole('button',{name:'确认重置',exact:true})).toBeFocused();
    await expect(box.locator('iframe')).toHaveAttribute('data-instance',instance!);
    expect(await panel.evaluate(()=>(window as any).resetRequests)).toBe(0);
  }finally{await context.close();await rm(root,{recursive:true,force:true});}
});

test('upgrading actual 1.0.7 to current UI preserves model settings, history and confirmed tool state',async()=>{
  test.setTimeout(60000);
  const {cp}=await import('node:fs/promises');
  const {version}=JSON.parse(await readFile('extensions/space-browsa/upstream.json','utf8'));
  const id=JSON.parse(await readFile('extensions/space-browsa/identity.json','utf8')).extensionId;
  const root=await mkdtemp(join(tmpdir(),'space-ui-upgrade-')),extension=join(root,'extension');
  await cp(resolve('.data/packages/space-browsa-1.0.7'),extension,{recursive:true});
  const context=await chromium.launchPersistentContext(join(root,'profile'),{headless:true,executablePath:process.env.CHROMIUM_PATH,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  try{
    const manager=await context.newPage();await manager.goto('chrome://extensions');
    if(await manager.locator('#devMode').getAttribute('aria-pressed')!=='true')await manager.locator('#devMode').click();
    const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const html=await readFile('tests/fixtures/tools/calculator.html','utf8');
    const providers={retained:{type:'llm',baseUrl:'http://localhost:8795/v1',apiKey:'fixture-only',model:'retained-model',models:['retained-model'],apiStyle:'chat'}};
    await panel.evaluate(({html,providers})=>(window as any).chrome.storage.local.set({providers,activeProvider:'retained',history:[{role:'assistant',content:'```space-ui\n'+html+'\n```'}]}),{html,providers});await panel.reload();
    const tool=panel.frameLocator('.space-ai-ui > iframe').frameLocator('#tool');await expect(tool.locator('#answer')).toHaveText('5');
    await tool.locator('#a').fill('8');await tool.locator('#b').fill('2');await tool.locator('#multiply').click();await expect(tool.locator('#answer')).toHaveText('16');
    const close=panel.getByRole('button',{name:'收起',exact:true});await close.scrollIntoViewIfNeeded();await close.click();await expect(panel.locator('.space-ai-ui > iframe')).toHaveCount(0);
    const before=await panel.evaluate(()=>(window as any).chrome.storage.local.get(['history','providers','activeProvider','spaceToolStateV1']));
    await cp(resolve(`.data/packages/space-browsa-${version}`),extension,{recursive:true});
    const store=await context.newPage();await store.goto('http://localhost:5173');
    await store.evaluate(({id,version})=>(window as any).chrome.runtime.sendMessage(id,{scope:'space-store/v1',type:'RELOAD',version}),{id,version});
    await expect.poll(async()=>{try{return await store.evaluate(async id=>(await (window as any).chrome.runtime.sendMessage(id,{scope:'space-store/v1',type:'PING'})).version,id)}catch{return''}}).toBe(version);
    const updated=await context.newPage();await updated.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(updated.locator('.space-tool-card')).toBeVisible();await expect(updated.frameLocator('.space-ai-ui > iframe').frameLocator('#tool').locator('#answer')).toHaveText('16');
    const after=await updated.evaluate(()=>(window as any).chrome.storage.local.get(['history','providers','activeProvider','spaceToolStateV1']));
    expect(after.history).toEqual(before.history);expect(after.providers).toEqual(providers);expect(after.activeProvider).toBe('retained');
    const messageId=before.history[0].spaceToolMessageId;expect(after.spaceToolStateV1[messageId].state.data).toEqual(before.spaceToolStateV1[messageId].state.data);
  }finally{await context.close();await rm(root,{recursive:true,force:true});}
});
