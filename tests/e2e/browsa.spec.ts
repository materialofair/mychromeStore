import { test, expect, chromium, request } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { unzipSync, zipSync } from 'fflate';
import { createApp, bootstrap, createUser } from '../../server/app';

test('full browsa package: approval, custom model streaming, reload and retained settings', async () => {
  test.setTimeout(180000);
  const packagePath = resolve('.data/packages/space-browsa-1.0.0.zip');
  test.skip(!existsSync(packagePath), 'Run npm run browsa:build for this optional full-package integration test');
  const origin = 'http://localhost:5173';
  const app = createApp({ dbPath: ':memory:', origin });
  const password = 'isolated-browsa-test-password';
  await bootstrap(app.db, 'browsa_admin', password);
  await createUser(app.db, { username: 'browsa_dev', password, role: 'developer' });
  await new Promise<void>(r => app.server.listen(8792, '127.0.0.1', r));
  const credentials: { model: string; authorization: string; path: string }[] = [];
  const mock = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const input = body ? JSON.parse(body) : {};
    if (req.url === '/v1/chat/completions') {
      credentials.push({ model: input.model, authorization: req.headers.authorization || '', path: req.url });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
      res.end('data: {"choices":[{"delta":{"content":"SPACE model connection works."}}]}\n\ndata: [DONE]\n\n');
    } else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise<void>(r => mock.listen(8793, '127.0.0.1', r));
  const root = await mkdtemp(join(tmpdir(), 'space-browsa-e2e-'));
  const extension = join(root, 'extension');
  await cp(resolve('.data/packages/space-browsa-1.0.0'), extension, { recursive: true });
  await mkdir(join(root, 'profile/Default'), { recursive: true });
  await writeFile(join(root, 'profile/Default/Preferences'), JSON.stringify({ extensions: { ui: { developer_mode: true } } }));
  const context = await chromium.launchPersistentContext(join(root, 'profile'), {
    headless: true, channel: 'chromium', executablePath: process.env.CHROMIUM_PATH,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const clients: Awaited<ReturnType<typeof request.newContext>>[] = [];
  try {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions');
    if (await manager.locator('#devMode').getAttribute('aria-pressed') !== 'true') await manager.locator('#devMode').click();
    async function login(username: string) {
      const client = await request.newContext({ baseURL: 'http://localhost:8792', extraHTTPHeaders: { Origin: origin } });
      clients.push(client);
      const response = await client.post('/api/login', { data: { username, password } });
      expect(response.ok()).toBeTruthy();
      const { csrfToken } = await response.json();
      return { client, headers: { 'X-CSRF-Token': csrfToken } };
    }
    const dev = await login('browsa_dev'), admin = await login('browsa_admin');
    const id = JSON.parse(await readFile('extensions/space-browsa/identity.json', 'utf8')).extensionId;
    const first = await readFile(packagePath);
    const files = unzipSync(first);
    const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
    manifest.version = '1.0.1'; // Only this isolated fixture uses an incremented test version.
    files['manifest.json'] = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    const next = Buffer.from(zipSync(files));
    for (const zip of [first, next]) {
      const upload = await dev.client.post('/api/submissions', { data: zip, headers: { ...dev.headers, 'Content-Type': 'application/zip' } });
      expect(upload.status(), await upload.text()).toBe(201);
      const { submission } = await upload.json();
      const hidden = await context.request.get(`http://localhost:8792/api/extensions/${id}/releases/${submission.version}.zip`);
      expect(hidden.status()).toBe(404);
      const review = await admin.client.post(`/api/submissions/${submission.id}/review`, { data: { decision: 'approved', reason: 'isolated integration fixture' }, headers: admin.headers });
      expect(review.status(), await review.text()).toBe(200);
    }
    await context.route(`${origin}/api/**`, async route => {
      const response = await route.fetch({ url: route.request().url().replace(origin, 'http://localhost:8792') });
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    await page.goto(origin);
    const ping = () => page.evaluate(async id => (window as any).chrome.runtime.sendMessage(id, { scope: 'space-store/v1', type: 'PING' }), id);
    await expect.poll(async () => { try { return (await ping()).version; } catch { return ''; } }).toBe('1.0.0');
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    const card = options.locator('.provider.reserved');
    await card.locator('[data-k=baseUrl]').fill('http://localhost:8793/v1');
    await card.locator('[data-k=apiKey]').fill('only-a-local-test-key');
    await card.locator('.chip-input').fill('space-test-model');
    await card.locator('.chip-input').press('Enter');
    await card.locator('[data-k=apiStyle]').selectOption('chat');
    await card.locator('[data-act=save]').click();
    await expect(options.locator('.provider.reserved')).toHaveCount(0);
    await options.locator('.provider').filter({ has: options.locator('[data-k=baseUrl][value="http://localhost:8793/v1"]') }).locator('h3').click();
    await options.evaluate(async () => (window as any).chrome.storage.local.set({ contextMode: 'manual', llmsTxtEnabled: false }));
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel.locator('#input').fill('Please confirm the connection');
    await panel.locator('#send').click();
    await expect(panel.getByText('SPACE model connection works.', { exact: true })).toBeVisible({ timeout: 15000 });
    expect(credentials.at(-1)).toEqual({ model: 'space-test-model', authorization: 'Bearer only-a-local-test-key', path: '/v1/chat/completions' });
    const before = await panel.evaluate(() => (window as any).chrome.storage.local.get(['providers', 'activeProvider', 'history']));
    await panel.screenshot({ path: 'test-results/browsa-chat.png' });
    // Filesystem transaction is exercised against browser OPFS below; this copy
    // separately proves the real loaded extension's reload preserves its data.
    await writeFile(join(extension, 'manifest.json'), files['manifest.json']);
    await page.evaluate(async id => (window as any).chrome.runtime.sendMessage(id, { scope: 'space-store/v1', type: 'RELOAD', version: '1.0.1' }), id);
    await expect.poll(async () => { try { return (await ping()).version; } catch { return ''; } }, { timeout: 10000 }).toBe('1.0.1');
    const afterPage = await context.newPage();
    await afterPage.goto(`chrome-extension://${id}/options.html`);
    expect(await afterPage.evaluate(() => (window as any).chrome.storage.local.get(['providers', 'activeProvider', 'history']))).toEqual(before);
    // Exercise actual large release data, browser filesystem writes and durable backup.
    const result = await page.evaluate(async id => {
      const core = await import(String('/src/core.ts'));
      const storage = await import(String('/src/storage.ts'));
      const catalog = await (await fetch(`/api/extensions/${id}/catalog`)).json();
      const old = await (await fetch(`/api/extensions/${id}/releases/1.0.0.json`)).json();
      const next = await (await fetch(`/api/extensions/${id}/releases/1.0.1.json`)).json();
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('browsa', { create: true });
      const data = (await core.validateRelease(old, catalog)).data;
      for (const [path, bytes] of Object.entries(data)) {
        const parts = path.split('/'); const name = parts.pop()!; let parent = dir;
        for (const part of parts) parent = await parent.getDirectoryHandle(part, { create: true });
        const stream = await (await parent.getFileHandle(name, { create: true })).createWritable();
        await stream.write(bytes as any); await stream.close();
      }
      const journal = storage.scopedStorage(id).journal;
      await core.install(dir as any, old, next, catalog, journal);
      const installed = await core.inspect(dir as any, catalog);
      await core.restore(journal);
      return { installed, restored: await core.inspect(dir as any, catalog), fileCount: Object.keys(data).length };
    }, id);
    expect(result.installed).toBe('1.0.1'); expect(result.restored).toBe('1.0.0'); expect(result.fileCount).toBeGreaterThan(125);
    await page.goto(`${origin}/update.html?id=${id}`);
    await expect(page.getByText('SPACE AI — powered by browsa', { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: 'test-results/browsa-updater.png', fullPage: true });
    const wrong = await context.newPage(); await wrong.goto('http://localhost:8793');
    expect(await wrong.evaluate(async id => {
      try { return (await (window as any).chrome.runtime.sendMessage(id, { scope: 'space-store/v1', type: 'PING' })) ?? null; } catch { return null; }
    }, id)).toBeNull();
  } finally {
    for (const client of clients) await client.dispose();
    await context.close(); await app.close();
    mock.closeAllConnections(); await new Promise<void>(r => mock.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
