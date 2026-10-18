import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { instantiateUnicodeEngine } from '../src/wasm/loader';

async function load(path: string) {
  return instantiateUnicodeEngine(await readFile(new URL(path, import.meta.url)));
}

describe('historical Unicode engine dispatch assets', () => {
  it('declares independently loadable current and historical profiles', async () => {
    const registry = JSON.parse(
      await readFile(new URL('../public/wasm/engines.json', import.meta.url), 'utf8'),
    ) as { defaultProfile: string; profiles: Record<string, string> };
    expect(registry.defaultProfile).toBe('unicode-17');
    expect(registry.profiles).toEqual({
      'unicode-15.1': 'unicode-15-1.json',
      'unicode-17': 'unicode-current.json',
    });
  });

  it('exposes the same ABI while preserving its pinned normalization data', async () => {
    const [historical, current] = await Promise.all([
      load('../public/wasm/unicodd_unicode_15.wasm'),
      load('../public/wasm/unicodd_ops_core.wasm'),
    ]);
    const scalar = Uint32Array.of(0xa7f1);
    expect(historical.abiVersion).toBe(current.abiVersion);
    expect(historical.normalize('NFKC', scalar)).toEqual(scalar);
    expect(current.normalize('NFKC', scalar)).toEqual(Uint32Array.of(0x53));
  });

  it('retains established normalization behavior in both profiles', async () => {
    const [historical, current] = await Promise.all([
      load('../public/wasm/unicodd_unicode_15.wasm'),
      load('../public/wasm/unicodd_ops_core.wasm'),
    ]);
    for (const engine of [historical, current]) {
      expect(engine.normalize('NFC', Uint32Array.of(0x65, 0x301))).toEqual(Uint32Array.of(0xe9));
      expect(engine.normalize('NFKC', Uint32Array.of(0x2460))).toEqual(Uint32Array.of(0x31));
    }
  });
});
