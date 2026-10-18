import { UnicodeWasmAdapter } from './adapter';
import {
  UNICODE_ABI_VERSION,
  type UnicodeEngineManifest,
  type UnicodeEngineRegistry,
} from './types';

const registryUrl = `${import.meta.env.BASE_URL}wasm/engines.json`;
let registryPromise: Promise<UnicodeEngineRegistry> | null = null;
const enginePromises = new Map<string, Promise<LoadedUnicodeEngine>>();

export interface LoadedUnicodeEngine {
  adapter: UnicodeWasmAdapter;
  manifest: UnicodeEngineManifest;
}

export async function loadUnicodeEngine(profileId?: string): Promise<LoadedUnicodeEngine> {
  const registry = await loadRegistry();
  const selectedProfile = profileId ?? registry.defaultProfile;
  const cached = enginePromises.get(selectedProfile);
  if (cached) return cached;

  const engine = loadProfile(registry, selectedProfile);
  enginePromises.set(selectedProfile, engine);
  try {
    return await engine;
  } catch (reason) {
    enginePromises.delete(selectedProfile);
    throw reason;
  }
}

async function loadRegistry(): Promise<UnicodeEngineRegistry> {
  registryPromise ??= fetch(registryUrl).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Could not load Unicode engine registry (${response.status}).`);
    }
    return (await response.json()) as UnicodeEngineRegistry;
  });
  return registryPromise;
}

async function loadProfile(
  registry: UnicodeEngineRegistry,
  profileId: string,
): Promise<LoadedUnicodeEngine> {
  const manifestFile = registry.profiles[profileId];
  if (!manifestFile) throw new Error(`Unknown Unicode engine profile “${profileId}”.`);
  const absoluteRegistryUrl = new URL(registryUrl, window.location.href);
  const manifestUrl = new URL(manifestFile, absoluteRegistryUrl);
  const manifestResponse = await fetch(manifestUrl);
  if (!manifestResponse.ok) {
    throw new Error(
      `Could not load Unicode engine manifest for ${profileId} (${manifestResponse.status}).`,
    );
  }
  const manifest = (await manifestResponse.json()) as UnicodeEngineManifest;
  if (manifest.abiVersion !== UNICODE_ABI_VERSION) {
    throw new Error(
      `Manifest declares ABI ${manifest.abiVersion}; expected ${UNICODE_ABI_VERSION}.`,
    );
  }

  const binaryUrl = new URL(manifest.binary, manifestUrl);
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
