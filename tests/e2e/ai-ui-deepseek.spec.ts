import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Background/occluded iframes may throttle RAF; never wait indefinitely on paint.
const settlePaint=async(element:any,outer:any)=>{await outer.scrollIntoViewIfNeeded();await element.scrollIntoViewIfNeeded();await Promise.race([element.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())))),new Promise<void>(r=>setTimeout(r,200))]);};

test('real DeepSeek HTML reply renders an interactive calculator instead of source', async () => {
  test.setTimeout(90000);
  const { version } = JSON.parse(await readFile('extensions/space-browsa/upstream.json', 'utf8'));
  const source = resolve(`.data/packages/space-browsa-${version}`);
  const id = JSON.parse(await readFile('extensions/space-browsa/identity.json', 'utf8')).extensionId;
  const raw = await readFile('tests/fixtures/ai-ui-deepseek-calculator.md', 'utf8');
  let release: (() => void) | undefined;
  let requests = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* local replay, no real key */ }
    requests++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const delta = (content: string) => res.write('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n');
    delta(raw.slice(0, -4));
    await new Promise<void>(r => { release = r; });
    delta(raw.slice(-4));
    res.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const root = await mkdtemp(join(tmpdir(), 'space-deepseek-ui-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(join(root, 'profile'), {
      channel: 'chromium', headless: true, executablePath: process.env.CHROMIUM_PATH,
      args: [`--disable-extensions-except=${source}`, `--load-extension=${source}`],
    });
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel.evaluate(port => (window as any).chrome.storage.local.set({
      providers: { test: { type: 'llm', alias: 'DeepSeek replay', baseUrl: `http://localhost:${port}`, apiKey: 'fixture-only', model: 'deepseek-flash', models: ['deepseek-flash'], apiStyle: 'chat', stream: true } },
      activeProvider: 'test', llmsTxtEnabled: false, deepExtractEnabled: false,
    }), port);
    await panel.reload();
    await panel.locator('#input').fill('做一个可交互的加减乘除计算器');
    await panel.getByRole('button', { name: 'AI UI', exact: true }).click();
    await panel.locator('#send').click();
    await expect.poll(() => !!release).toBe(true);
    await expect(panel.locator('.space-ai-ui iframe')).toHaveCount(0);
    release!();
    const ui = panel.frameLocator('.space-ai-ui iframe');
    await expect(ui.locator('#ui-a')).toBeVisible();
    await expect(panel.locator('.space-ai-ui-source')).toHaveCount(1);
    await expect(panel.locator('.space-ai-ui-source pre')).toBeHidden();
    await panel.locator('.space-ai-ui iframe').scrollIntoViewIfNeeded();
    await settlePaint(ui.locator('#ui-a'),panel.locator('.space-ai-ui iframe'));
    await ui.locator('#ui-a').fill('8');
    await ui.locator('#ui-b').fill('2');
    await settlePaint(ui.locator('#ui-add'),panel.locator('.space-ai-ui iframe'));
    await ui.locator('#ui-add').click(); await expect(ui.locator('#ui-result')).toHaveText('10');
    await ui.locator('#ui-sub').click(); await expect(ui.locator('#ui-result')).toHaveText('6');
    await ui.locator('#ui-mul').click(); await expect(ui.locator('#ui-result')).toHaveText('16');
    await ui.locator('#ui-div').click(); await expect(ui.locator('#ui-result')).toHaveText('4');
    await panel.locator('.space-ai-ui-source summary').click();
    await expect(panel.locator('.space-ai-ui-source pre')).toContainText('application/space-ui+json');
    await panel.locator('.space-ai-ui-source summary').click();
    await panel.setViewportSize({ width: 420, height: 900 });
    await panel.screenshot({ path: 'test-results/ai-ui-deepseek-calculator.png', fullPage: true });
    await panel.reload();
    await expect(ui.locator('#ui-result')).toHaveText('0');
    await expect(panel.locator('.space-ai-ui-source pre')).toBeHidden();
    expect(requests).toBe(1);
  } finally {
    release?.(); await context?.close(); server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});

test('real generated inline layout keeps both inputs inside a narrow preview', async () => {
  const { version } = JSON.parse(await readFile('extensions/space-browsa/upstream.json', 'utf8'));
  const source = resolve(`.data/packages/space-browsa-${version}`);
  const id = JSON.parse(await readFile('extensions/space-browsa/identity.json', 'utf8')).extensionId;
  const raw = await readFile('tests/fixtures/ai-ui-deepseek-live.md', 'utf8');
  const root = await mkdtemp(join(tmpdir(), 'space-ui-layout-'));
  const context = await chromium.launchPersistentContext(join(root, 'profile'), {
    channel: 'chromium', headless: true, executablePath: process.env.CHROMIUM_PATH,
    viewport: { width: 420, height: 900 },
    args: [`--disable-extensions-except=${source}`, `--load-extension=${source}`],
  });
  try {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel.evaluate(raw => (window as any).chrome.storage.local.set({ history: [{ role: 'assistant', content: raw }] }), raw);
    await panel.reload();
    const ui = panel.frameLocator('.space-ai-ui iframe');
    await expect(ui.locator('#ui-b')).toBeVisible();
    const frame = panel.frames().find(f => f.url().includes('sandbox.html'))!;
    const layout = await frame.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(layout.width).toBeLessThanOrEqual(layout.viewport);
    await settlePaint(ui.locator('#ui-add'),panel.locator('.space-ai-ui iframe'));
    await ui.locator('#ui-add').click(); await expect(ui.locator('#ui-result')).toHaveText('10');
    await settlePaint(ui.locator('#ui-result'),panel.locator('.space-ai-ui iframe'));
    await panel.screenshot({ path: 'test-results/ai-ui-deepseek-narrow.png', fullPage: true });
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); }
});
