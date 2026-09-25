import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

describe('browsa store bridge', () => {
  function bridge() {
    let listener: (message: unknown, sender: unknown, respond: (value: unknown) => void) => unknown;
    const timers: (() => void)[] = [];
    let reloads = 0;
    runInNewContext(readFileSync('extensions/space-browsa/store-bridge.js', 'utf8').replace('__SPACE_STORE_ORIGIN__', JSON.stringify('https://store.example.com')), {
      URL, setTimeout: (fn: () => void) => timers.push(fn),
      chrome: { runtime: { id: 'test-id', getManifest: () => ({ version: '1.0.0' }), reload: () => reloads++,
        onMessageExternal: { addListener: (fn: typeof listener) => listener = fn } } },
    });
    return { send(message: unknown, sender: unknown) { let value: unknown; listener!(message, sender, reply => value = reply); return value; }, timers, reloads: () => reloads };
  }
  it('only exposes version and schedules a reload to the exact store origin', () => {
    const b = bridge(), sender = { url: 'https://store.example.com/update.html' };
    expect(b.send({ scope: 'space-store/v1', type: 'PING' }, sender)).toEqual({ id: 'test-id', version: '1.0.0' });
    expect(b.send({ scope: 'space-store/v1', type: 'RELOAD', version: '1.0.1' }, sender)).toEqual({ accepted: true });
    expect(b.reloads()).toBe(0); b.timers[0](); expect(b.reloads()).toBe(1);
  });
  it('rejects lookalike hosts, ports, extensions, malformed URLs and data access', () => {
    const b = bridge();
    for (const sender of [{ url: 'https://store.example.com:444/' }, { url: 'https://store.example.com.evil.test/' }, { url: 'invalid' }, {}, { url: 'https://store.example.com/', id: 'other-extension' }]) {
      expect(b.send({ scope: 'space-store/v1', type: 'RELOAD', version: '1.0.1' }, sender)).toBeUndefined();
    }
    for (const message of [null, { scope: 'other', type: 'PING' }, { scope: 'space-store/v1', type: 'GET_CONFIG' }, { scope: 'space-store/v1', type: 'RELOAD', version: '../evil' }]) {
      expect(b.send(message, { url: 'https://store.example.com/' })).toBeUndefined();
    }
    expect(b.timers).toHaveLength(0);
  });
});
