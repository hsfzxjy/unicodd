import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { instantiateUnicodeEngine } from '../src/wasm/loader';

async function loadAdapter() {
  const bytes = await readFile(new URL('../public/wasm/unicodd_ops_core.wasm', import.meta.url));
  return instantiateUnicodeEngine(bytes);
}

describe('raw Unicode WebAssembly adapter', () => {
  it('loads the expected ABI without wasm-bindgen', async () => {
    const adapter = await loadAdapter();
    expect(adapter.abiVersion).toBe(1);
  });

  it('normalizes scalar sequences with ICU4X', async () => {
    const adapter = await loadAdapter();

    expect(adapter.normalize('NFC', Uint32Array.from([0x65, 0x301]))).toEqual(
      Uint32Array.from([0xe9]),
    );
    expect(adapter.normalize('NFD', Uint32Array.from([0xe9]))).toEqual(
      Uint32Array.from([0x65, 0x301]),
    );
    expect(adapter.normalize('NFKC', Uint32Array.from([0x2460]))).toEqual(Uint32Array.from([0x31]));
  });

  it('handles empty and non-BMP scalar sequences', async () => {
    const adapter = await loadAdapter();

    expect(adapter.normalize('NFC', new Uint32Array())).toEqual(new Uint32Array());
    expect(adapter.normalize('NFC', Uint32Array.from([0x1f9e9]))).toEqual(
      Uint32Array.from([0x1f9e9]),
    );
  });

  it('rejects invalid scalar input before crossing the ABI', async () => {
    const adapter = await loadAdapter();
    expect(() => adapter.normalize('NFC', Uint32Array.from([0xd800]))).toThrow(
      /Invalid Unicode scalar value/,
    );
  });
});
