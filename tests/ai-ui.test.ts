import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
// @ts-expect-error JS recipe module
import { parseUi, MAX_UI_CHARS, isUiBlocked } from '../extensions/space-browsa/ai-ui/protocol.mjs';
describe('explicit AI UI protocol', () => {
  it('leaves text and ordinary HTML fences alone', () => {
    expect(parseUi('hello').state).toBe('none');
    expect(parseUi('```html\n<button>hi</button>\n```').state).toBe('none');
    expect(parseUi('````text\n```space-ui\na\n```\n````').state).toBe('none');
  });
  it('requires a completed fence and preserves the source', () => {
    const raw = 'text\n```space-ui\n<button>hi</button>\n```\nmore';
    expect(parseUi(raw)).toEqual({ state:'ready', html:'<button>hi</button>' });
    for (const cut of [10, 20, 30]) expect(parseUi(raw.slice(0, cut)).state).not.toBe('ready');
    expect(parseUi('~~~space-ui\nhi\n~~~').state).toBe('ready');
  });
  it('recognizes real DeepSeek HTML with an explicit UI program declaration', async () => {
    const raw = await readFile('tests/fixtures/ai-ui-deepseek-calculator.md', 'utf8');
    const result = parseUi(raw);
    expect(result.state).toBe('ready');
    expect(result.html).toContain('application/space-ui+json');
    expect(parseUi(raw.slice(0, raw.lastIndexOf('```'))).state).toBe('pending');
    expect(parseUi('```html\n<script>alert(1)</script>\n```').state).toBe('none');
    expect(parseUi('````text\n' + raw + '\n````').state).toBe('none');
    expect(parseUi(raw + '\n' + raw).state).toBe('error');
    expect(parseUi(raw + '\n_(cancelled)_').state).toBe('none');
  });
  it('accepts HTML native tools with an explicit SDK marker, leaving generic scripts as code', () => {
    expect(parseUi('```html\n<meta name="space-tool" content="1"><script>spaceTool.setResult({summary:"hi",data:1})</script>\n```').state).toBe('ready');
    expect(parseUi('```html\n<script>console.log(1)</script>\n```').state).toBe('none');
  });
  it('only executes the final answer, ignoring complete and unfinished fences in reasoning', () => {
    const html='<meta name="space-tool" content="1"><button>Final tool</button>';
    const answer='```html\n'+html+'\n```';
    for(const tag of ['thinking','think','antml:thinking']) {
      for(const draft of ['```html\nDraft without closing fence','```space-ui\nDraft tool\n```']) {
        expect(parseUi(`<${tag}>\n${draft}\n</${tag}>\n${answer}`)).toEqual({state:'ready',html});
      }
      expect(parseUi(`<${tag}>\n${answer}`)).toEqual({state:'none'});
    }
    expect(parseUi('```text\n<thinking>\n```\n'+answer)).toEqual({state:'ready',html});
    const literal='<meta name="space-tool" content="1"><thinking>literal HTML</thinking>';
    expect(parseUi('```html\n'+literal+'\n```')).toEqual({state:'ready',html:literal});
    expect(parseUi('<thinking>\n<think>nested</think>\n'+answer)).toEqual({state:'none'});
    expect(parseUi('<thinking>\n<think>nested</think>\n'+answer+'\n</thinking>\n'+answer)).toEqual({state:'ready',html});
    expect(parseUi('<thinking-widget>literal</thinking-widget>\n'+answer)).toEqual({state:'ready',html});
    expect(parseUi('<thinking\nclass="reasoning">\n'+answer+'\n</thinking>\n'+answer)).toEqual({state:'ready',html});
    expect(parseUi(answer+'\n<thinking>\n_(cancelled)_')).toEqual({state:'none'});
    for(const literal of ['const close="</thinking>";','const open="<thinking>";']) {
      expect(parseUi('<thinking>\n```js\n'+literal+'\n```\n</thinking>\n'+answer)).toEqual({state:'ready',html});
    }
  });
  it('recognizes the unmodified default-thinking DeepSeek SSE answer', async () => {
    const raw=await readFile('tests/fixtures/tools/deepseek-thinking-calculator.md','utf8');
    const result=parseUi(raw);
    expect(result.state).toBe('ready');
    expect(result.html).toContain('<title>简易计算器</title>');
    expect(result.html).not.toContain('<thinking>');
  });
  it('rejects oversized, empty, duplicate and cancelled outputs', () => {
    const block = '```space-ui\na\n```';
    expect(parseUi(block+'\n'+block).state).toBe('error');
    expect(parseUi('```space-ui\n\n```').state).toBe('error');
    expect(parseUi('```space-ui\n'+'a'.repeat(MAX_UI_CHARS+1)+'\n```').state).toBe('error');
    expect(parseUi(block+'\n\n_(cancelled)_').state).toBe('none');
  });
  it('keeps sandbox limits explicit and does not add permissions', async () => {
    const patch = await readFile('extensions/space-browsa/ai-ui-patch.mjs','utf8');
    expect(patch).toContain("sandbox allow-scripts; default-src 'none'");
    for (const rule of ["connect-src 'none'", "form-action 'none'", "frame-src 'none'", "worker-src 'none'"]) expect(patch).toContain(rule);
    expect(patch).not.toContain('permissions.push');
    expect(patch).not.toContain('allow-same-origin');
  });
});

it('uses the same interrupted/truncated policy for live and history messages', () => {
  expect(isUiBlocked({})).toBe(false);
  expect(isUiBlocked({interrupted:true})).toBe(true);
  expect(isUiBlocked({outputTruncated:true})).toBe(true);
  expect(isUiBlocked({interrupted:false,outputTruncated:false})).toBe(false);
});
