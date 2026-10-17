import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { stringToUnicodeScalars } from '../src/unicode';
import { instantiateUnicodeEngine } from '../src/wasm/loader';

async function loadAdapter() {
  const bytes = await readFile(new URL('../public/wasm/unicodd_ops_core.wasm', import.meta.url));
  return instantiateUnicodeEngine(bytes);
}

describe('raw Unicode WebAssembly adapter', () => {
  it('loads the expected ABI without wasm-bindgen', async () => {
    const adapter = await loadAdapter();
    expect(adapter.abiVersion).toBe(3);
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

  it('applies full default Unicode case folding', async () => {
    const adapter = await loadAdapter();
    expect(adapter.caseFold(stringToUnicodeScalars('Straße Σς'))).toEqual(
      stringToUnicodeScalars('strasse σσ'),
    );
  });

  it('segments combining, supplementary, emoji ZWJ, regional, and invisible sequences', async () => {
    const adapter = await loadAdapter();

    expect(adapter.graphemeBoundaries(new Uint32Array())).toEqual(Uint32Array.of(0));
    expect(adapter.graphemeBoundaries(Uint32Array.from([0x65, 0x301, 0x1f9e9]))).toEqual(
      Uint32Array.from([0, 2, 3]),
    );
    expect(
      adapter.graphemeBoundaries(
        Uint32Array.from([0x1f469, 0x200d, 0x1f4bb, 0x1f1fa, 0x1f1f8, 0x200b]),
      ),
    ).toEqual(Uint32Array.from([0, 3, 5, 6]));
  });

  it('returns assigned Unicode names without inventing missing data', async () => {
    const adapter = await loadAdapter();

    expect(adapter.name(0x1f9e9)).toBe('JIGSAW PUZZLE PIECE');
    expect(adapter.name(0x200b)).toBe('ZERO WIDTH SPACE');
    expect(adapter.name(0x378)).toBeNull();
  });

  it('rejects invalid scalar input before crossing the ABI', async () => {
    const adapter = await loadAdapter();
    expect(() => adapter.normalize('NFC', Uint32Array.from([0xd800]))).toThrow(
      /Invalid Unicode scalar value/,
    );
    expect(() => adapter.graphemeBoundaries(Uint32Array.from([0x110000]))).toThrow(
      /Invalid Unicode scalar value/,
    );
    expect(() => adapter.name(0xd800)).toThrow(/invalid Unicode scalar/);
  });
});
