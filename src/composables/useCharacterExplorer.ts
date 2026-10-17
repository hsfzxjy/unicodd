import { computed, shallowRef, type ShallowRef } from 'vue';
import { moveHistory, pushHistory, type ExplorerHistory } from '../explorer/history';
import { unicodeScalarArraysEqual } from '../unicode';
import type { UnicodeWasmAdapter } from '../wasm/adapter';

const emptyScalars = new Uint32Array();

export function useCharacterExplorer(
  adapter: Readonly<ShallowRef<UnicodeWasmAdapter | undefined>>,
) {
  const history = shallowRef<ExplorerHistory>({ entries: [], index: -1 });
  const target = computed(() => history.value.entries[history.value.index] ?? emptyScalars);

  function explore(nextTarget: Uint32Array): void {
    history.value = pushHistory(history.value, nextTarget);
  }

  function back(): void {
    history.value = moveHistory(history.value, -1);
  }

  function forward(): void {
    history.value = moveHistory(history.value, 1);
  }

  const canonical = computed(() => {
    const result =
      adapter.value && target.value.length
        ? adapter.value.normalize('NFD', target.value)
        : emptyScalars;
    return {
      result,
      changed: !unicodeScalarArraysEqual(target.value, result),
      names: adapter.value
        ? Array.from(result, (scalar) => adapter.value?.name(scalar) ?? null)
        : [],
    };
  });

  const compatibility = computed(() => {
    if (!adapter.value || !target.value.length) {
      return { result: emptyScalars, changed: false, names: [] };
    }
    const result = adapter.value.normalize('NFKD', target.value);
    return {
      result,
      changed: !unicodeScalarArraysEqual(canonical.value.result, result),
      names: Array.from(result, (scalar) => adapter.value?.name(scalar) ?? null),
    };
  });

  const names = computed(() =>
    adapter.value ? Array.from(target.value, (scalar) => adapter.value?.name(scalar) ?? null) : [],
  );
  const graphemeCount = computed(() => {
    if (!adapter.value || target.value.length === 0) return 0;
    return Math.max(adapter.value.graphemeBoundaries(target.value).length - 1, 0);
  });

  const canGoBack = computed(() => history.value.index > 0);
  const canGoForward = computed(() => history.value.index < history.value.entries.length - 1);
  const historyPosition = computed(() => (history.value.index < 0 ? 0 : history.value.index + 1));
  const historyLength = computed(() => history.value.entries.length);

  return {
    target,
    canonical,
    compatibility,
    names,
    graphemeCount,
    canGoBack,
    canGoForward,
    historyPosition,
    historyLength,
    explore,
    back,
    forward,
  };
}
