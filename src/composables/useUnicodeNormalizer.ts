import { computed, onMounted, ref, shallowRef, watch, type Ref } from 'vue';
import { unicodeScalarsToString } from '../unicode';
import { loadUnicodeEngine } from '../wasm/loader';
import type { UnicodeWasmAdapter } from '../wasm/adapter';

export type EngineStatus = 'loading' | 'ready' | 'error';

export function useUnicodeNormalizer(scalars: Readonly<Ref<Uint32Array>>) {
  const adapter = shallowRef<UnicodeWasmAdapter>();
  const status = ref<EngineStatus>('loading');
  const error = ref<string | null>(null);
  const engineId = ref<string | null>(null);
  const normalizedScalars = shallowRef<Uint32Array>(new Uint32Array());

  function normalizeCurrent(): void {
    if (!adapter.value) return;
    try {
      normalizedScalars.value = adapter.value.normalize('NFC', scalars.value);
      error.value = null;
    } catch (reason) {
      status.value = 'error';
      error.value = reason instanceof Error ? reason.message : 'Unicode normalization failed.';
    }
  }

  onMounted(async () => {
    try {
      const engine = await loadUnicodeEngine();
      adapter.value = engine.adapter;
      engineId.value = engine.manifest.engineId;
      status.value = 'ready';
      normalizeCurrent();
    } catch (reason) {
      status.value = 'error';
      error.value = reason instanceof Error ? reason.message : 'Unicode engine failed to load.';
    }
  });

  watch(scalars, normalizeCurrent);

  const normalizedText = computed(() => unicodeScalarsToString(normalizedScalars.value));

  return { status, error, engineId, normalizedScalars, normalizedText };
}
