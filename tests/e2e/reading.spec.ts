import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, cp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

function pdf(text: string) {
  const stream = `BT /F1 12 Tf 40 700 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let content = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(content)); content += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(content);
}

test('SPACE reading: documents, removal, protected draft, current page summary and keyboard selection', async () => {
  test.setTimeout(120000);
  const { version } = JSON.parse(await readFile('extensions/space-browsa/upstream.json', 'utf8'));
  const source = resolve(`.data/packages/space-browsa-${version}`);
  test.skip(!existsSync(source), 'Run npm run browsa:build to generate the current package');
  const calls: any[] = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    if (req.url === '/v1/chat/completions') {
      calls.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"Reading response complete."}}]}\n\ndata: [DONE]\n\n');
    } else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise<void>(r => server.listen(8795, '127.0.0.1', r));
  const root = await mkdtemp(join(tmpdir(), 'space-reading-'));
  const extension = join(root, 'extension'); await cp(source, extension, { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, 'profile'), {
    channel: 'chromium', headless: true, executablePath: process.env.CHROMIUM_PATH,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    await context.route('https://space-reading.example/**', route => route.fulfill({ contentType: 'text/html', body:
      '<!doctype html><title>SPACE Reading Article</title><main><article><h1>SPACE Reading Article</h1><p id="selectable">Keyboard selection should open the reading toolbar without a mouse.</p>' +
      `<p>${'ArticleEvidence729 is the source of this page. The team reads articles and verifies the original evidence before making decisions. '.repeat(20)}</p></article><textarea id="editable">Private editable text</textarea></main>` }));
    const id = JSON.parse(await readFile('extensions/space-browsa/identity.json', 'utf8')).extensionId;
    const settings = await context.newPage(); await settings.goto(`chrome-extension://${id}/options.html`);
    await settings.evaluate(() => (window as any).chrome.storage.local.set({
      providers: { test: { type: 'llm', alias: 'Reading test', baseUrl: 'http://localhost:8795/v1', apiKey: 'local-test-only', model: 'reading-model', models: ['reading-model'], apiStyle: 'chat', stream: true } },
      activeProvider: 'test', llmsTxtEnabled: false, deepExtractEnabled: false,
    }));
    const article = await context.newPage(); await article.goto('https://space-reading.example/article');
    const panel = await context.newPage(); await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel.locator('#input').waitFor();
    await panel.evaluate(async () => {
      const [tab] = await (window as any).chrome.tabs.query({ url: 'https://space-reading.example/article' });
      await (window as any).chrome.tabs.update(tab.id, { active: true });
    });
    const chooserEvent = panel.waitForEvent('filechooser');
    await panel.locator('#space-add-files').click();
    const chooser = await chooserEvent;
    await chooser.setFiles([
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('TextEvidence351') },
      { name: 'report.md', mimeType: 'text/markdown', buffer: Buffer.from('# MarkdownEvidence452') },
      { name: 'report.pdf', mimeType: 'application/pdf', buffer: pdf('PdfEvidence563') },
    ]);
    await expect(panel.locator('[data-space-attachment][data-status="ready"]')).toHaveCount(3, { timeout: 30000 });
    await panel.locator('[data-space-attachment]').filter({ hasText: 'report.md' }).locator('[data-space-remove]').click();
    await panel.locator('#input').fill('KeepDraft672');
    await panel.locator('[data-cmd="/summarize"]').click();
    await expect(panel.locator('#input')).toHaveValue('KeepDraft672');
    expect(calls).toHaveLength(0);
    await panel.locator('#send').click();
    await expect.poll(() => calls.length).toBe(1);
    const sent = JSON.stringify(calls[0].messages);
    expect(sent).toContain('TextEvidence351'); expect(sent).toContain('PdfEvidence563'); expect(sent).toContain('KeepDraft672');
    expect(sent).not.toContain('MarkdownEvidence452');
    await expect(panel.getByText('Reading response complete.', { exact: true }).first()).toBeVisible();
    await expect(panel.locator('[data-space-attachment]')).toHaveCount(0);
    await panel.locator('#imagepicker').setInputFiles({ name: 'program.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('unsupported') });
    await expect(panel.locator('[data-space-attachment][data-status="error"]')).toContainText('仅支持 TXT');
    // Remove an error card if the unsupported-file policy exposes one.
    for (const button of await panel.locator('[data-space-remove]').all()) await button.click();
    await panel.evaluate(async () => {
      const [tab] = await (window as any).chrome.tabs.query({ url: 'https://space-reading.example/article' });
      await (window as any).chrome.tabs.update(tab.id, { active: true });
    });
    await panel.locator('[data-cmd="/summarize"]').click();
    await expect.poll(() => calls.length, { timeout: 30000 }).toBe(2);
    expect(JSON.stringify(calls[1].messages)).toContain('ArticleEvidence729');
    const material = panel.locator('details.space-reading-material');
    await expect(material).toHaveCount(1);
    await expect(material.locator('pre')).toBeHidden();
    await material.locator('summary').click();
    await expect(material.locator('pre')).toContainText('ArticleEvidence729');
    await material.locator('summary').click();
    await expect.poll(async () => panel.evaluate(async () => {
      const { history } = await (window as any).chrome.storage.local.get('history');
      return history?.filter((entry: any) => entry.role === 'assistant').length;
    })).toBe(2);
    await panel.reload();
    await expect(panel.locator('details.space-reading-material')).toHaveCount(2);
    await expect(panel.locator('details.space-reading-material[open]')).toHaveCount(0);
    await panel.screenshot({ path: `test-results/space-reading-${version}.png` });
    await article.bringToFront();
    await article.setViewportSize({ width: 320, height: 720 });
    const cdp = await context.newCDPSession(article);
    const toolbar = async () => {
      const tree = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      function find(node: any): any {
        const attrs = node.attributes || [];
        if (attrs.some((value: string, i: number) => value === 'id' && attrs[i + 1] === 'bar')) return node;
        for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const result = find(child); if (result) return result; }
      }
      const node = find(tree.root);
      if (!node) return { visible: false, x: 0, width: 0 };
      const { object } = await cdp.send('DOM.resolveNode', { nodeId: node.nodeId });
      const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId!, returnByValue: true,
        functionDeclaration: 'function() { const r=this.getBoundingClientRect(); return {visible:this.classList.contains("vis"),x:r.x,width:r.width}; }' });
      await cdp.send('Runtime.releaseObject', { objectId: object.objectId! });
      return result.value;
    };
    await article.evaluate(() => {
      const node = document.querySelector('#selectable')!.firstChild!;
      const selection = getSelection()!; selection.removeAllRanges();
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 15); selection.addRange(range);
    });
    await article.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => (await toolbar()).visible).toBe(true);
    const bounds = await toolbar();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(321);
    await article.keyboard.press('Escape');
    await expect.poll(async () => (await toolbar()).visible).toBe(false);
    await article.keyboard.press('Shift+ArrowRight');
    await article.keyboard.press('Escape');
    await article.waitForTimeout(400); // Escape must also cancel the delayed selection display.
    expect((await toolbar()).visible).toBe(false);
    await article.locator('#editable').focus(); await article.keyboard.press('ControlOrMeta+A'); await article.keyboard.press('Shift+ArrowLeft');
    await expect.poll(async () => (await toolbar()).visible).toBe(false);
  } finally {
    await context.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
