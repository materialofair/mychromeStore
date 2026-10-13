import { test, expect, chromium } from '@playwright/test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('native HTML CSS JS tools: calculator, dynamic graph and physics, zoom and durable reopen', async () => {
  test.setTimeout(120000);
  const { version } = JSON.parse(await readFile('extensions/space-browsa/upstream.json', 'utf8'));
  const source = resolve(`.data/packages/space-browsa-${version}`);
  const id = JSON.parse(await readFile('extensions/space-browsa/identity.json', 'utf8')).extensionId;
  const root = await mkdtemp(join(tmpdir(), 'space-native-tools-'));
  const launch = () => chromium.launchPersistentContext(join(root, 'profile'), {
    channel: 'chromium', headless: true, executablePath: process.env.CHROMIUM_PATH,
    viewport: { width: 1100, height: 900 }, args: [`--disable-extensions-except=${source}`, `--load-extension=${source}`],
  });
  let context = await launch();
  try {
    const panel = await context.newPage(); await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const history = await Promise.all(['calculator', 'graph', 'physics'].map(async name => ({ role: 'assistant', content: '```space-ui\n' + await readFile(`tests/fixtures/tools/${name}.html`, 'utf8') + '\n```' })));
    await panel.evaluate(history => (window as any).chrome.storage.local.set({ history }), history);
    await panel.reload();
    const boxes = panel.locator('.space-ai-ui');
    const control=async(i:number,name:string)=>{const button=boxes.nth(i).getByRole('button',{name,exact:true});await button.scrollIntoViewIfNeeded();await button.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));await button.click();};
    const tool = (i: number) => panel.frameLocator('.space-ai-ui > iframe').nth(i).frameLocator('#tool');
    const calc = tool(0), graph = tool(1), physics = tool(2);
    await expect(calc.locator('#answer')).toHaveText('5');
    expect(await boxes.nth(0).evaluate(el=>getComputedStyle(el.closest('.msg')!).contentVisibility)).toBe('visible');
    expect(await calc.locator('h2').evaluate(el => getComputedStyle(el).color)).toBe('rgb(20, 80, 120)');
    await calc.locator('#a').fill('8'); await calc.locator('#b').fill('2');
    await calc.locator('#multiply').click(); await expect(calc.locator('#answer')).toHaveText('16');
    const instance = await boxes.nth(0).locator('iframe').getAttribute('data-instance');
    await control(0,'放大');
    await expect(boxes.nth(0)).toHaveClass(/space-ai-ui-expanded/);
    await expect(calc.locator('#answer')).toHaveText('16');
    expect(await boxes.nth(0).locator('iframe').getAttribute('data-instance')).toBe(instance);
    await control(0,'缩小');
    await graph.locator('#gain').fill('3'); await expect(graph.locator('#value')).toHaveText('3');
    await expect.poll(() => graph.locator('canvas').evaluate((c: any) => c.toDataURL())).not.toBe('');
    await physics.locator('#step').click(); await physics.locator('#step').click();
    await expect(physics.locator('#steps')).toHaveText('2');
    await physics.locator('#run').click();
    await expect.poll(async () => Number(await physics.locator('#steps').textContent())).toBeGreaterThan(2);
    await physics.locator('#stop').click();
    const steps = await physics.locator('#steps').textContent();
    for (let i = 0; i < 3; i++) await expect(boxes.nth(i).locator('.space-tool-status')).toContainText('已保存');
    await control(0,'收起');
    await expect(boxes.nth(0).locator('iframe')).toHaveCount(0);
    await control(0,'重新打开');
    await expect(calc.locator('#answer')).toHaveText('16');
    await expect(calc.locator('#a')).toHaveValue('8');
    await panel.reload();
    await expect(calc.locator('#answer')).toHaveText('16');
    await expect(graph.locator('#value')).toHaveText('3');
    await expect(physics.locator('#steps')).toHaveText(steps!);
    await context.close(); context = await launch();
    const restored = await context.newPage(); await restored.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(restored.frameLocator('.space-ai-ui > iframe').nth(0).frameLocator('#tool').locator('#answer')).toHaveText('16');
    await expect(restored.frameLocator('.space-ai-ui > iframe').nth(1).frameLocator('#tool').locator('#value')).toHaveText('3');
    await expect(restored.frameLocator('.space-ai-ui > iframe').nth(2).frameLocator('#tool').locator('#steps')).toHaveText(steps!);
    await restored.setViewportSize({ width: 420, height: 900 });
    await restored.locator('.space-ai-ui').nth(2).scrollIntoViewIfNeeded();
    await restored.screenshot({ path: 'test-results/ai-tools-physics.png', fullPage: true });
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); }
});
