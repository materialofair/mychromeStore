import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, cp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('SPACE network: actual CDP credentials, bodies, redirects, selection, Markdown export and chat attachment', async () => {
  test.setTimeout(120000);
  const source = resolve('.data/packages/space-browsa-1.0.2');
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    if (req.url === '/v1/chat/completions') {
      requests.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"Network analysis complete."}}]}\n\ndata: [DONE]\n\n');
    } else if (req.url?.startsWith('/api')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Response-Token': 'raw-response-token' });
      res.end(JSON.stringify({ evidence: 'ResponseEvidence93', body, cookie: req.headers.cookie, token: req.headers.authorization, hostile: '```\n<img src=x onerror=alert(1)>\n# heading' }));
    } else if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/api?redirect=1', 'X-Hop': 'redirect-first' }); res.end();
    } else if (req.url === '/fail') {
      req.socket.destroy();
    } else if (req.url === '/slow') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: waiting\n\n');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'session=raw-test-cookie; HttpOnly; Path=/' });
      res.end('<!doctype html><title>Network fixture</title><h1>Network request fixture</h1>');
    }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port, origin = `http://localhost:${port}`;
  const root = await mkdtemp(join(tmpdir(), 'space-network-'));
  const extension = join(root, 'extension'); await cp(source, extension, { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, 'profile'), {
    channel: 'chromium', headless: true, executablePath: process.env.CHROMIUM_PATH,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    acceptDownloads: true,
  });
  try {
    const id = JSON.parse(await readFile('extensions/space-browsa/identity.json', 'utf8')).extensionId;
    const settings = await context.newPage(); await settings.goto(`chrome-extension://${id}/options.html`);
    await settings.evaluate(async ({ origin }) => {
      await (window as any).chrome.storage.local.set({ providers: { test: { type: 'llm', alias: 'Network test', baseUrl: origin + '/v1', apiKey: 'fake-model-key', model: 'network-test', models: ['network-test'], apiStyle: 'chat', stream: true } }, activeProvider: 'test', llmsTxtEnabled: false, deepExtractEnabled: false });
    }, { origin });
    const article = await context.newPage(); await article.goto(origin);
    const panel = await context.newPage(); const errors: string[] = [];
    panel.on('pageerror', error => errors.push(error.message));
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel.locator('#space-network-open').waitFor();
    const selectArticle = () => panel.evaluate(async origin => {
      const [tab] = await (window as any).chrome.tabs.query({ url: origin + '/*' });
      await (window as any).chrome.tabs.update(tab.id, { active: true });
    }, origin);
    await selectArticle();
    await panel.locator('#space-network-open').click();
    await panel.getByRole('button', { name: '开始记录当前页', exact: true }).click();
    await expect.poll(async () => ({ status: (await panel.locator('[data-status]').textContent())?.includes('记录中'), error: await panel.locator('[data-error]').textContent() })).toEqual({ status: true, error: '' });
    await article.evaluate(async () => {
      await fetch('/api?q=one&q=two', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer raw-test-auth' }, body: JSON.stringify({ token: 'raw-request-token', message: 'RequestEvidence72' }) });
      await fetch('/redirect');
      await fetch('/fail').catch(() => {});
      void fetch('/slow');
    });
    const other = await context.newPage(); await other.goto(origin + '/unrelated');
    await other.evaluate(() => fetch('/api?OtherTabShouldNotAppear=1'));
    await panel.getByRole('button', { name: '停止记录', exact: true }).click();
    await expect(panel.locator('[data-status]')).toContainText('已停止');
    await expect(panel.locator('.space-network-record').first()).toBeVisible();
    const records = await panel.locator('.space-network-record summary').allTextContents();
    expect(records.join('\n')).not.toContain('OtherTabShouldNotAppear');
    expect(records.join('\n')).toContain('/redirect');
    const apiRow = panel.locator('.space-network-record').filter({ hasText: '/api?q=one' });
    await apiRow.locator('summary').click();
    await expect(apiRow.locator('pre')).toContainText('raw-test-cookie');
    await expect(apiRow.locator('pre')).toContainText('Bearer raw-test-auth');
    await expect(apiRow.locator('pre')).toContainText('ResponseEvidence93');
    await expect(apiRow.locator('pre')).toContainText('RequestEvidence72');
    await expect(apiRow.locator('img')).toHaveCount(0);
    await apiRow.locator('input[type="checkbox"]').check();
    await panel.locator('[data-analysis]').fill('Separate analysis note');
    await panel.locator('[data-include-analysis]').check();
    const downloadEvent = panel.waitForEvent('download');
    await panel.getByRole('button', { name: '导出选中 MD', exact: true }).click();
    const download = await downloadEvent, downloadPath = await download.path();
    const md = await readFile(downloadPath!, 'utf8');
    expect(download.suggestedFilename()).toMatch(/^space-network-.*\.md$/);
    expect(md).toContain('raw-test-auth'); expect(md).toContain('raw-test-cookie'); expect(md).toContain('raw-response-token');
    expect(md).toContain('Separate analysis note'); expect(md).not.toContain('## 请求 2');
    expect(requests).toHaveLength(0);
    await panel.setViewportSize({ width: 360, height: 780 });
    expect(await panel.locator('#space-network').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await panel.locator('#space-network').evaluate(el => { el.scrollTop = 0; });
    await panel.screenshot({ path: 'test-results/space-network-1.0.2-narrow.png' });
    await selectArticle();
    await panel.getByRole('button', { name: '选中请求附加到对话', exact: true }).click();
    expect(await panel.locator('#space-network-open').evaluate(el => el.getBoundingClientRect().right <= innerWidth)).toBe(true);
    expect(await panel.locator('#settings').evaluate(el => el.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await expect(panel.locator('[data-space-attachment][data-status="ready"]')).toHaveCount(1);
    expect(requests).toHaveLength(0);
    await panel.locator('#input').fill('分析所附请求日志，找出请求和响应字段。');
    await panel.locator('#send').click();
    await expect.poll(() => requests.length).toBe(1);
    const prompt = JSON.stringify(requests[0].messages);
    expect(prompt).toContain('raw-test-cookie'); expect(prompt).toContain('raw-test-auth');
    expect(prompt).not.toContain('Separate analysis note');
    await expect(panel.getByText('Network analysis complete.', { exact: true }).first()).toBeVisible();
    await panel.reload();
    await panel.locator('#space-network-open').click();
    await expect(panel.locator('.space-network-record')).toHaveCount(records.length);
    const allDownload = panel.waitForEvent('download');
    await panel.getByRole('button', { name: '导出全部 MD', exact: true }).click();
    const all = await readFile((await (await allDownload).path())!, 'utf8');
    expect(all).toContain('redirect-first'); expect(all).toContain('请求失败'); expect(all).toContain('停止时响应尚未完成');
    await panel.getByRole('button', { name: '清空日志', exact: true }).click();
    await expect(panel.locator('[data-status]')).toContainText('尚未记录');
    await panel.evaluate(async () => {
      const api = (window as any).chrome;
      const [tab] = await api.tabs.query({ url: api.runtime.getURL('options.html') });
      await api.tabs.update(tab.id, { active: true });
    });
    await panel.getByRole('button', { name: '开始记录当前页', exact: true }).click();
    await expect(panel.locator('[data-error]')).toContainText('仅支持 HTTP(S)');
    await panel.locator('#space-network').evaluate(el => { el.scrollTop = 0; });
    await panel.screenshot({ path: 'test-results/space-network-1.0.2-error.png' });
    expect(errors).toEqual([]);
  } finally {
    await context.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
