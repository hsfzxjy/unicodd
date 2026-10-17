import { onMounted, ref, shallowRef } from 'vue';
import type { UnicodeWasmAdapter } from '../wasm/adapter';
import { loadUnicodeEngine } from '../wasm/loader';

export type EngineStatus = 'loading' | 'ready' | 'error';

export function useUnicodeEngine() {
  const adapter = shallowRef<UnicodeWasmAdapter>();
  const status = ref<EngineStatus>('loading');
  const error = ref<string | null>(null);
  const engineId = ref<string | null>(null);

  onMounted(async () => {
    try {
      const engine = await loadUnicodeEngine();
      adapter.value = engine.adapter;
      engineId.value = engine.manifest.engineId;
      status.value = 'ready';
    } catch (reason) {
      status.value = 'error';
      error.value = reason instanceof Error ? reason.message : 'Unicode engine failed to load.';
    }
  });

  return { adapter, status, error, engineId };
}
