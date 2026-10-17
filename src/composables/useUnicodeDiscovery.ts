import { computed, ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import type {
  CharacterProperties,
  CharacterSearchResult,
  RelationshipGroup,
} from '../explorer/discoveryTypes';
import { loadNameIndex, loadRelationshipIndex } from '../explorer/loadDiscovery';
import type { UnicodeWasmAdapter } from '../wasm/adapter';

export type DiscoveryStatus = 'loading' | 'ready' | 'error';
export type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

export function useUnicodeDiscovery(
  adapter: Readonly<ShallowRef<UnicodeWasmAdapter | undefined>>,
  target: Readonly<Ref<Uint32Array>>,
) {
  const relationshipIndex = shallowRef<Awaited<ReturnType<typeof loadRelationshipIndex>>>();
  const status = ref<DiscoveryStatus>('loading');
  const error = ref<string | null>(null);
  const searchStatus = ref<SearchStatus>('idle');
  const searchError = ref<string | null>(null);
  const searchResults = shallowRef<CharacterSearchResult[]>([]);
  let searchRevision = 0;

  void loadRelationshipIndex()
    .then((index) => {
      relationshipIndex.value = index;
      status.value = 'ready';
    })
    .catch((reason: unknown) => {
      status.value = 'error';
      error.value = reason instanceof Error ? reason.message : 'Unicode discovery data failed.';
    });

  function nameScalars(input: Uint32Array): string | null {
    const engine = adapter.value;
    if (!engine || input.length === 0) return null;
    const names = Array.from(input, (scalar) => engine.name(scalar));
    return names.every(Boolean) ? names.join(' + ') : null;
  }

  const relationships = computed<RelationshipGroup[]>(() => {
    const index = relationshipIndex.value;
    const engine = adapter.value;
    if (!index || !engine || target.value.length === 0) return [];
    return index.relationships(
      target.value,
      (input) => engine.normalize('NFD', input),
      nameScalars,
    );
  });

  const properties = computed<Array<CharacterProperties | null>>(() => {
    const index = relationshipIndex.value;
    return index
      ? Array.from(target.value, (scalar) => index.propertiesFor(scalar))
      : Array.from(target.value, () => null);
  });

  async function search(query: string): Promise<void> {
    const revision = ++searchRevision;
    if (!query.trim()) {
      searchResults.value = [];
      searchStatus.value = 'idle';
      searchError.value = null;
      return;
    }

    searchStatus.value = 'loading';
    searchError.value = null;
    try {
      const index = await loadNameIndex();
      if (revision !== searchRevision) return;
      searchResults.value = index.search(query);
      searchStatus.value = 'ready';
    } catch (reason: unknown) {
      if (revision !== searchRevision) return;
      searchStatus.value = 'error';
      searchError.value = reason instanceof Error ? reason.message : 'Unicode name search failed.';
    }
  }

  const unicodeVersion = computed(() => relationshipIndex.value?.unicodeVersion ?? null);
  const uts39Version = computed(() => relationshipIndex.value?.uts39Version ?? null);

  return {
    relationshipIndex,
    status,
    error,
    relationships,
    properties,
    searchStatus,
    searchError,
    searchResults,
    unicodeVersion,
    uts39Version,
    search,
  };
}
