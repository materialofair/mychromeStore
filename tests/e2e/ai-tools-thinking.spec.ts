import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

for(const sample of ['complete','unfinished','real-deepseek']) {
  test(`reasoning draft ${sample} cannot replace the final interactive tool`,async()=>{
    test.setTimeout(60000);
    const html=await readFile('tests/fixtures/tools/calculator.html','utf8');
    const raw=sample==='real-deepseek' ? await readFile('tests/fixtures/tools/deepseek-thinking-calculator.md','utf8') : '';
    const draft=raw ? raw.slice('<thinking>\n'.length,raw.indexOf('\n</thinking>')) : sample==='complete' ? '```space-ui\n<h1>Discarded draft</h1>\n```' : '```html\nUnfinished reasoning draft';
    const quote=sample==='complete' ? '> ```html\n> <meta name="space-tool" content="1"><p>Quoted example stays unchanged</p>\n> ```\n\n' : '';
    const answer=raw ? raw.slice(raw.indexOf('</thinking>')+'</thinking>\n'.length) : quote+'```html\n'+html+'\n```';
    const server=createServer(async(req,res)=>{
      for await(const _ of req){}
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      for(const delta of [{reasoning_content:draft.slice(0,9)},{reasoning_content:draft.slice(9)},{content:answer.slice(0,25)},{content:answer.slice(25)}]) {
        res.write('data: '+JSON.stringify({choices:[{delta,finish_reason:null}]})+'\n\n');
      }
      res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
    });
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
    const {version}=JSON.parse(await readFile('extensions/space-browsa/upstream.json','utf8'));
    const source=resolve(`.data/packages/space-browsa-${version}`);
    const id=JSON.parse(await readFile('extensions/space-browsa/identity.json','utf8')).extensionId;
    const root=await mkdtemp(join(tmpdir(),'space-reasoning-ui-'));
    const context=await chromium.launchPersistentContext(join(root,'profile'),{headless:true,executablePath:process.env.CHROMIUM_PATH,args:[`--disable-extensions-except=${source}`,`--load-extension=${source}`]});
    try {
      const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
      await panel.evaluate(port=>(window as any).chrome.storage.local.set({providers:{test:{type:'llm',baseUrl:`http://localhost:${port}`,apiKey:'fixture-only',model:'deepseek-flash',models:['deepseek-flash'],apiStyle:'chat',stream:true}},activeProvider:'test',llmsTxtEnabled:false,deepExtractEnabled:false}),port);
      await panel.reload();await panel.locator('#input').fill('生成交互计算器');await panel.locator('#send').click();
      const tool=panel.frameLocator('.space-ai-ui > iframe').frameLocator('#tool');
      if(raw) {
        await expect(tool.locator('#go')).toBeVisible();
        await panel.locator('.space-ai-ui > iframe').scrollIntoViewIfNeeded();
        await tool.locator('#a').fill('8');await tool.locator('#b').fill('2');
        for(const [op,result] of [['+','10'],['-','6'],['*','16'],['/','4']]) {
          await tool.locator('#op').selectOption(op);await tool.locator('#go').click();await expect(tool.locator('#out b')).toHaveText(result);
        }
      } else await expect(tool.locator('#answer')).toHaveText('5');
      await expect(panel.locator('.space-ai-ui')).toHaveCount(1);
      await expect(panel.locator('.space-ai-ui-source')).toHaveCount(1);
      await expect(panel.locator('.space-ai-ui-source pre')).toBeHidden();
      if(quote)await expect(panel.locator('blockquote pre code')).toContainText('Quoted example stays unchanged');
      await expect(panel.locator('.space-tool-status')).toContainText('已保存');
      const stored=await panel.evaluate(async()=>((await (window as any).chrome.storage.local.get('history')).history||[]).find((m:any)=>m.role==='assistant'));
      expect(stored.content).toBe('<thinking>\n'+draft+'\n</thinking>\n'+answer);
      if(raw) {
        const close=panel.getByRole('button',{name:'收起',exact:true});await close.scrollIntoViewIfNeeded();await close.click();
        await expect(panel.locator('.space-ai-ui > iframe')).toHaveCount(0);
      }
      await panel.reload();await expect(tool.locator(raw?'#out b':'#answer')).toHaveText(raw?'4':'5');
      await expect(panel.locator('.space-tool-status')).toContainText('已保存');
    } finally {await context.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
  });
}
