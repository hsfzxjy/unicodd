import { computed, shallowRef, type ShallowRef } from 'vue';
import {
  activateExploration,
  addExploration,
  createExplorerHistory,
  type ExplorationRelation,
  type ExplorerHistory,
} from '../explorer/history';
import { unicodeScalarArraysEqual } from '../unicode';
import type { UnicodeWasmAdapter } from '../wasm/adapter';

const emptyScalars = new Uint32Array();

export function useCharacterExplorer(
  adapter: Readonly<ShallowRef<UnicodeWasmAdapter | undefined>>,
) {
  const history = shallowRef<ExplorerHistory>(createExplorerHistory());
  const target = computed(
    () =>
      history.value.nodes.find(({ id }) => id === history.value.activeNodeId)?.target ??
      emptyScalars,
  );

  function explore(nextTarget: Uint32Array, relation: ExplorationRelation): void {
    history.value = addExploration(history.value, nextTarget, relation);
  }

  function activate(nodeId: string): void {
    history.value = activateExploration(history.value, nodeId);
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

  const historyLength = computed(() => history.value.nodes.length);

  return {
    target,
    canonical,
    compatibility,
    names,
    graphemeCount,
    historyLength,
    history,
    explore,
    activate,
  };
}
