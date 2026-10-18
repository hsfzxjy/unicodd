import { onMounted, ref, shallowRef } from 'vue';
import type { UnicodeWasmAdapter } from '../wasm/adapter';
import { loadUnicodeEngine } from '../wasm/loader';

export type EngineStatus = 'loading' | 'ready' | 'error';

export function useUnicodeEngine() {
  const adapter = shallowRef<UnicodeWasmAdapter>();
  const status = ref<EngineStatus>('loading');
  const error = ref<string | null>(null);
  const engineId = ref<string | null>(null);
  const historicalAdapter = shallowRef<UnicodeWasmAdapter>();
  const historicalStatus = ref<'idle' | EngineStatus>('idle');
  const historicalError = ref<string | null>(null);
  const historicalEngineId = ref<string | null>(null);

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

  async function loadHistoricalProfile(profileId: string): Promise<void> {
    if (historicalStatus.value === 'loading' || historicalAdapter.value) return;
    historicalStatus.value = 'loading';
    historicalError.value = null;
    try {
      const loaded = await loadUnicodeEngine(profileId);
      historicalAdapter.value = loaded.adapter;
      historicalEngineId.value = loaded.manifest.engineId;
      historicalStatus.value = 'ready';
    } catch (reason) {
      historicalStatus.value = 'error';
      historicalError.value =
        reason instanceof Error ? reason.message : 'Historical Unicode engine failed to load.';
    }
  }

  return {
    adapter,
    status,
    error,
    engineId,
    historicalAdapter,
    historicalStatus,
    historicalError,
    historicalEngineId,
    loadHistoricalProfile,
  };
}
