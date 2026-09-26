import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, cp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('SPACE 1.0.0 upgrades to the real reading 1.0.1 package without losing settings or history', async () => {
  test.setTimeout(45000);
  const old = resolve('.data/packages/space-browsa-1.0.0');
  const next = resolve('.data/packages/space-browsa-1.0.1');
  test.skip(!existsSync(old) || !existsSync(next), 'Requires both released local packages');
  const root = await mkdtemp(join(tmpdir(), 'space-upgrade-'));
  const extension = join(root, 'extension'); await cp(old, extension, { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, 'profile'), {
    channel: 'chromium', headless: true, executablePath: process.env.CHROMIUM_PATH,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const manager = await context.newPage(); await manager.goto('chrome://extensions');
    if (await manager.locator('#devMode').getAttribute('aria-pressed') !== 'true') await manager.locator('#devMode').click();
    const id = JSON.parse(await readFile('extensions/space-browsa/identity.json', 'utf8')).extensionId;
    const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
    const saved = {
      providers: { retained: { type: 'llm', alias: 'Retained provider', baseUrl: 'http://localhost:8795/v1', apiKey: 'only-local-test-key', model: 'retained-model', models: ['retained-model'], apiStyle: 'chat' } },
      activeProvider: 'retained', history: [{ role: 'user', content: 'Keep my previous conversation.' }],
    };
    await options.evaluate(value => (window as any).chrome.storage.local.set(value), saved);
    const store = await context.newPage(); await store.goto('http://localhost:5173');
    await cp(next, extension, { recursive: true });
    await store.evaluate(id => (window as any).chrome.runtime.sendMessage(id, { scope: 'space-store/v1', type: 'RELOAD', version: '1.0.1' }), id);
    await expect.poll(async () => {
      try { return await store.evaluate(async id => (await (window as any).chrome.runtime.sendMessage(id, { scope: 'space-store/v1', type: 'PING' })).version, id); }
      catch { return ''; }
    }).toBe('1.0.1');
    const updated = await context.newPage(); await updated.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(updated.locator('#space-add-files')).toBeVisible();
    expect(await updated.evaluate(() => (window as any).chrome.storage.local.get(['providers', 'activeProvider', 'history']))).toEqual(saved);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); }
});
