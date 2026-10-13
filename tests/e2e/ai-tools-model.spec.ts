import { test, expect, chromium } from '@playwright/test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('complete real DeepSeek native calculator, graph and physics run, zoom and retain application state', async () => {
  test.setTimeout(120000);
  const { version } = JSON.parse(await readFile('extensions/space-browsa/upstream.json','utf8'));
  const source=resolve(`.data/packages/space-browsa-${version}`);
  const id=JSON.parse(await readFile('extensions/space-browsa/identity.json','utf8')).extensionId;
  const root=await mkdtemp(join(tmpdir(),'space-model-tools-'));
  const launch=()=>chromium.launchPersistentContext(join(root,'profile'),{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH,viewport:{width:1100,height:950},args:[`--disable-extensions-except=${source}`,`--load-extension=${source}`]});
  let context=await launch();
  try {
    const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const history=await Promise.all(['calculator','graph','physics'].map(async name=>({role:'assistant',content:await readFile(`tests/fixtures/tools/deepseek-${name}.md`,'utf8')})));
    await panel.evaluate(history=>(window as any).chrome.storage.local.set({history}),history);await panel.reload();
    const boxes=panel.locator('.space-ai-ui');
    const control=async(i:number,name:string)=>{const b=boxes.nth(i).getByRole('button',{name,exact:true});await b.scrollIntoViewIfNeeded();await b.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));await b.click();};
    const tool=(i:number)=>panel.frameLocator('.space-ai-ui > iframe').nth(i).frameLocator('#tool');
    const paintZoom=async(i:number)=>{const height=await boxes.nth(i).locator('iframe').evaluate(e=>e.clientHeight);await expect.poll(()=>tool(i).locator('html').evaluate(()=>innerHeight)).toBe(height);await tool(i).locator('body').evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));};
    const calc=tool(0),graph=tool(1),physics=tool(2);
    await expect(calc.locator('#a')).toHaveValue('8');
    await calc.locator('#a').fill('12');await calc.locator('#b').fill('4');
    await calc.locator('#multiply').click();await expect(calc.locator('#answer')).toHaveText('48');
    await calc.locator('#divide').click();await expect(calc.locator('#answer')).toHaveText('3');
    await calc.locator('#subtract').click();await expect(calc.locator('#answer')).toHaveText('8');
    await calc.locator('#add').click();await expect(calc.locator('#answer')).toHaveText('16');
    const instance=await boxes.nth(0).locator('iframe').getAttribute('data-instance');
    await control(0,'放大');await expect(boxes.nth(0)).toHaveClass(/space-ai-ui-expanded/);
    await expect(calc.locator('#answer')).toHaveText('16');expect(await boxes.nth(0).locator('iframe').getAttribute('data-instance')).toBe(instance);
    await paintZoom(0);await panel.screenshot({path:'test-results/ai-tools-model-calculator.png'});await control(0,'缩小');
    await expect(graph.locator('#chart')).toBeVisible();
    const before=await graph.locator('#chart').evaluate((c:any)=>c.toDataURL());
    await graph.locator('#amplitude').fill('3');await expect(graph.locator('#ampVal')).toContainText('3');
    expect(await graph.locator('#chart').evaluate((c:any)=>c.toDataURL())).not.toBe(before);
    await graph.locator('#step').click();await expect(graph.locator('#frames')).toHaveText('1');
    await graph.locator('#run').click();await expect.poll(async()=>Number(await graph.locator('#frames').textContent())).toBeGreaterThan(1);
    await graph.locator('#stop').click();const frames=await graph.locator('#frames').textContent();
    await control(1,'放大');await expect(graph.locator('#amplitude')).toHaveValue('3');
    await paintZoom(1);await panel.screenshot({path:'test-results/ai-tools-model-graph.png'});await control(1,'缩小');
    await physics.locator('#step').click();await physics.locator('#step').click();await expect(physics.locator('#steps')).toHaveText('2');
    const ballBefore=await physics.locator('#world').evaluate((c:any)=>c.toDataURL());
    await physics.locator('#run').click();await expect.poll(async()=>Number(await physics.locator('#steps').textContent())).toBeGreaterThan(10);
    await physics.locator('#stop').click();const steps=await physics.locator('#steps').textContent(),time=await physics.locator('#time').textContent();
    expect(await physics.locator('#world').evaluate((c:any)=>c.toDataURL())).not.toBe(ballBefore);
    await physics.locator('#gravity').fill('1.6');await physics.locator('#gravity').press('Tab');
    for(let i=0;i<3;i++)await expect(boxes.nth(i).locator('.space-tool-status')).toContainText('已保存');
    const physicsState=await physics.locator('body').evaluate(()=>(window as any).spaceTool.loadState());
    await control(2,'放大');await paintZoom(2);await panel.screenshot({path:'test-results/ai-tools-model-physics.png'});await control(2,'缩小');
    for(let i=0;i<3;i++){await control(i,'收起');await expect(boxes.nth(i).locator('iframe')).toHaveCount(0);await control(i,'重新打开');}
    await expect(calc.locator('#answer')).toHaveText('16');await expect(graph.locator('#frames')).toHaveText(frames!);await expect(physics.locator('#steps')).toHaveText(steps!);await expect(physics.locator('#time')).toHaveText(time!);
    expect(await physics.locator('body').evaluate(()=>(window as any).spaceTool.loadState())).toEqual(physicsState);
    const saved=await panel.evaluate(async()=>{
      const r=await (window as any).chrome.runtime.sendMessage({type:'SAVE_SESSION',name:'Model tools'});
      await (window as any).chrome.runtime.sendMessage({type:'CLEAR_HISTORY'});return r.data.session.id;
    });await panel.reload();await expect(panel.locator('.space-ai-ui')).toHaveCount(0);
    await panel.evaluate(async id=>{await (window as any).chrome.runtime.sendMessage({type:'LOAD_SESSION',id});},saved);await panel.reload();
    await expect(calc.locator('#answer')).toHaveText('16');await expect(graph.locator('#amplitude')).toHaveValue('3');await expect(physics.locator('#gravity')).toHaveValue('1.6');
    await context.close();context=await launch();const reopened=await context.newPage();await reopened.goto(`chrome-extension://${id}/sidepanel.html`);
    const restored=(i:number)=>reopened.frameLocator('.space-ai-ui > iframe').nth(i).frameLocator('#tool');
    await expect(restored(0).locator('#answer')).toHaveText('16');await expect(restored(1).locator('#frames')).toHaveText(frames!);await expect(restored(2).locator('#steps')).toHaveText(steps!);
    await reopened.setViewportSize({width:420,height:900});
    for(let i=0;i<3;i++) {await restored(i).locator('body').waitFor();const width=await restored(i).locator('html').evaluate(el=>({width:el.scrollWidth,viewport:innerWidth}));expect(width.width).toBeLessThanOrEqual(width.viewport+1);}
  }finally{await context.close();await rm(root,{recursive:true,force:true});}
});
