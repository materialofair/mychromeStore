import { describe, expect, it } from 'vitest';
// @ts-expect-error JS recipe
import * as runtime from '../extensions/space-browsa/ai-ui/runtime.mjs';

describe('untrusted native tool payload boundary', () => {
  it('accepts finite JSON and rejects cycles, exotic objects, deep and oversized data', () => {
    expect(runtime.validateToolPayload({ data: [1, '中文'], forms: {}, result: null })).toEqual({ data: [1, '中文'], forms: {}, result: null });
    const cycle: any = {}; cycle.self = cycle;
    for (const invalid of [cycle, { value: Infinity }, new Map(), Array(10001), { large: 'x'.repeat(140000) }, JSON.parse('{"__proto__":{}}')]) {
      expect(() => runtime.validateToolPayload(invalid)).toThrow();
    }
    expect(() => runtime.validateToolPayload({ summary: 'x'.repeat(13000), data: null }, 12000)).toThrow();
  });
  it('cannot terminate bootstrap using restored state text', () => {
    const code = runtime.toolBootstrap({ data: '</script><script>bad()</script>', forms: {}, result: null }, '00000000-0000-0000-0000-000000000000');
    expect(code).not.toContain('</script>');
    expect(code).toContain('\\u003c/script>');
  });
});
