import { UnicodeWasmAdapter } from './adapter';
import { UNICODE_ABI_VERSION, type UnicodeEngineManifest } from './types';

const manifestUrl = '/wasm/unicode-current.json';

export interface LoadedUnicodeEngine {
  adapter: UnicodeWasmAdapter;
  manifest: UnicodeEngineManifest;
}

export async function loadUnicodeEngine(): Promise<LoadedUnicodeEngine> {
  const manifestResponse = await fetch(manifestUrl);
  if (!manifestResponse.ok) {
    throw new Error(`Could not load Unicode engine manifest (${manifestResponse.status}).`);
  }
  const manifest = (await manifestResponse.json()) as UnicodeEngineManifest;
  if (manifest.abiVersion !== UNICODE_ABI_VERSION) {
    throw new Error(
      `Manifest declares ABI ${manifest.abiVersion}; expected ${UNICODE_ABI_VERSION}.`,
    );
  }

  const binaryUrl = new URL(manifest.binary, new URL(manifestUrl, window.location.href));
  const response = await fetch(binaryUrl);
  if (!response.ok) throw new Error(`Could not load Unicode engine (${response.status}).`);

  let instance: WebAssembly.Instance;
  try {
    ({ instance } = await WebAssembly.instantiateStreaming(response.clone(), {}));
  } catch {
    ({ instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {}));
  }

  return { adapter: new UnicodeWasmAdapter(instance), manifest };
}

export async function instantiateUnicodeEngine(bytes: BufferSource): Promise<UnicodeWasmAdapter> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return new UnicodeWasmAdapter(instance);
}
