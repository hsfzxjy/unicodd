<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import CharacterExplorer from './components/CharacterExplorer.vue';
import CircuitView from './components/CircuitView.vue';
import PuzzleView from './components/PuzzleView.vue';
import UnicodeEditor from './components/UnicodeEditor.vue';
import { useCharacterExplorer } from './composables/useCharacterExplorer';
import { useUnicodeEditor } from './composables/useUnicodeEditor';
import { useUnicodeDiscovery } from './composables/useUnicodeDiscovery';
import { useUnicodeEngine } from './composables/useUnicodeEngine';
import { buildGraphemeRanges, scalarBoundaries, targetForSelection } from './explorer/graphemes';
import type { ExplorationRelation } from './explorer/history';
import type { EditorAction, GraphemeRange, TextSelection } from './explorer/types';
import { errorStatusSuffix, supportedLocales, useI18n, type AppLocale } from './i18n';
import { requiresDiscoveryIndex } from './puzzles/capabilities';
import { createPuzzleCollection, puzzleCollection } from './puzzles/collection';
import { preparePuzzleInput, serializeUtf16Units } from './puzzles/input';
import { puzzleHref, puzzleIndexFromSearch } from './puzzles/navigation';
import { insertSequenceValues } from './puzzles/sequenceEditing';
import type { PreparedPuzzleInput, PuzzleOperations } from './puzzles/types';
import { displaySequence, stringToUtf16CodeUnits, unicodeScalarsToString } from './unicode';

const editor = useUnicodeEditor('é');
const { locale, setLocale, t } = useI18n();
const engine = useUnicodeEngine();
const explorer = useCharacterExplorer(engine.adapter);
const discovery = useUnicodeDiscovery(engine.adapter, explorer.target);
const homeHref = import.meta.env.BASE_URL;
const discoveryOpen = ref(false);
const guideOpen = ref(true);
const closeDiscoveryButton = ref<HTMLButtonElement | null>(null);
const discoveryOverlay = ref<HTMLElement | null>(null);
let discoveryReturnFocus: HTMLElement | null = null;
let previousBodyOverflow = '';
const localizedPuzzles = computed(() => createPuzzleCollection(locale.value));
const puzzleDefinitions = computed(() =>
  localizedPuzzles.value.map(({ definition }) => definition),
);
const selectedPuzzleIndex = ref(
  puzzleIndexFromSearch(
    window.location.search,
    puzzleCollection.map(({ definition }) => definition),
  ),
);
const puzzleValues = reactive(
  Object.fromEntries(
    puzzleCollection.map(({ definition }) => [
      definition.id,
      Object.fromEntries(definition.inputs.map((input) => [input.id, input.initialValue])),
    ]),
  ) as Record<string, Record<string, string>>,
);

const selectedPuzzle = computed(
  () => localizedPuzzles.value[selectedPuzzleIndex.value] ?? localizedPuzzles.value[0]!,
);
const selectedPuzzleNeedsDiscovery = computed(() =>
  requiresDiscoveryIndex(selectedPuzzle.value.definition),
);
const preparedInputs = computed(() =>
  selectedPuzzle.value.definition.inputs.map((definition) =>
    preparePuzzleInput(
      definition,
      puzzleValues[selectedPuzzle.value.definition.id]?.[definition.id] ?? '',
    ),
  ),
);
const preparedInputMap = computed<Readonly<Record<string, PreparedPuzzleInput>>>(() =>
  Object.fromEntries(preparedInputs.value.map((input) => [input.definition.id, input])),
);
const puzzleOperations = computed<PuzzleOperations | null>(() => {
  const adapter = engine.adapter.value;
  const index = discovery.relationshipIndex.value;
  const historicalProfile = selectedPuzzle.value.definition.historicalUnicodeProfile;
  const historicalAdapter = engine.historicalAdapter.value;
  if (
    !adapter ||
    (selectedPuzzleNeedsDiscovery.value && !index) ||
    (historicalProfile && !historicalAdapter)
  ) {
    return null;
  }
  return {
    normalize: (form, input) => adapter.normalize(form, input),
    caseFold: (input) => adapter.caseFold(input),
    graphemeBoundaries: (input) => adapter.graphemeBoundaries(input),
    confusableSkeleton: index
      ? (input) => index.confusableSkeleton(input, (value) => adapter.normalize('NFD', value))
      : undefined,
    generalCategory: index
      ? (scalar) => index.propertiesFor(scalar)?.generalCategory ?? null
      : undefined,
    normalizeHistorical: historicalAdapter
      ? (form, input) => historicalAdapter.normalize(form, input)
      : undefined,
  };
});

const graphemeBoundaries = computed(() =>
  engine.adapter.value
    ? engine.adapter.value.graphemeBoundaries(editor.scalars.value)
    : scalarBoundaries(editor.scalars.value),
);
const graphemes = computed(() =>
  buildGraphemeRanges(editor.scalars.value, graphemeBoundaries.value),
);
const puzzleEvaluation = computed(() => {
  const operations = puzzleOperations.value;
  if (!operations || preparedInputs.value.some(({ error }) => error)) return null;
  return selectedPuzzle.value.evaluate(preparedInputMap.value, operations);
});
const puzzleGraph = computed(() => {
  const operations = puzzleOperations.value;
  return operations ? selectedPuzzle.value.createGraph(operations) : null;
});
const puzzleSources = computed(() =>
  preparedInputs.value.some(({ error }) => error)
    ? {}
    : selectedPuzzle.value.createSources(preparedInputMap.value),
);
const puzzleError = computed(() => {
  const inputError = preparedInputs.value.find(({ error }) => error)?.error;
  if (inputError) return inputError;
  if (engine.error.value) {
    return t('graph.engineError', {
      status: errorStatusSuffix(engine.error.value, locale.value),
    });
  }
  if (selectedPuzzle.value.definition.historicalUnicodeProfile && engine.historicalError.value) {
    return t('graph.historicalError', {
      status: errorStatusSuffix(engine.historicalError.value, locale.value),
    });
  }
  if (selectedPuzzleNeedsDiscovery.value && discovery.error.value) {
    return t('graph.discoveryError', {
      status: errorStatusSuffix(discovery.error.value, locale.value),
    });
  }
  return null;
});

watch(
  () => selectedPuzzle.value.definition.historicalUnicodeProfile,
  (profile) => {
    if (profile) void engine.loadHistoricalProfile(profile);
  },
  { immediate: true },
);

watch(
  () => selectedPuzzle.value.definition.title,
  (title) => {
    document.title = `${title} — unicodd`;
  },
  { immediate: true },
);

watch(
  selectedPuzzleNeedsDiscovery,
  (needed) => {
    if (needed) void discovery.ensureRelationships();
  },
  { immediate: true },
);

function inspectSelection(selection: TextSelection): void {
  editor.updateSelection(selection);
  try {
    const target = targetForSelection(
      editor.text.value,
      editor.scalars.value,
      graphemes.value,
      selection,
    );
    if (target) {
      explorer.explore(target, {
        kind: 'selection',
        label: locale.value === 'zh-CN' ? '从字符串中选择' : 'Selected from string',
      });
    }
  } catch {
    // Browser selections can bisect a surrogate pair. Preserve that editor selection without
    // replacing the valid explorer target with malformed UTF-16.
  }
}

function inspectGrapheme(grapheme: GraphemeRange): void {
  editor.selectRange({ start: grapheme.utf16Start, end: grapheme.utf16End });
  explorer.explore(grapheme.scalars, {
    kind: 'selection',
    label: locale.value === 'zh-CN' ? '从字符串中选择' : 'Selected from string',
  });
}

function exploreRelated(target: Uint32Array, relation: ExplorationRelation): void {
  explorer.explore(target, relation);
}

function editWithTarget(action: EditorAction): void {
  editor.applyScalars(explorer.target.value, action);
}

function insertDiscovered(target: Uint32Array): void {
  editor.applyScalars(target, 'insert');
}

function updatePuzzleInput(id: string, value: string): void {
  const values = puzzleValues[selectedPuzzle.value.definition.id];
  if (values) values[id] = value;
}

function useExploredTarget(id: string, insertionIndex: number): void {
  const input = selectedPuzzle.value.definition.inputs.find((candidate) => candidate.id === id);
  const prepared = preparedInputMap.value[id];
  if (!input || !prepared || exploredTargetIsEmpty()) return;

  if (input.kind === 'utf16-units') {
    if (!prepared.utf16) return;
    const discoveredUnits = stringToUtf16CodeUnits(unicodeScalarsToString(explorer.target.value));
    const combined = insertSequenceValues(
      Array.from(prepared.utf16),
      insertionIndex,
      Array.from(discoveredUnits),
    );
    updatePuzzleInput(id, serializeUtf16Units(Uint16Array.from(combined)));
    return;
  }

  if (!prepared.scalars) return;
  const combined = insertSequenceValues(
    Array.from(prepared.scalars),
    insertionIndex,
    Array.from(explorer.target.value),
  );
  updatePuzzleInput(id, unicodeScalarsToString(Uint32Array.from(combined)));
}

function exploredTargetIsEmpty(): boolean {
  return explorer.target.value.length === 0;
}

function selectPuzzle(index: number): void {
  const nextIndex = Math.min(Math.max(index, 0), localizedPuzzles.value.length - 1);
  if (nextIndex === selectedPuzzleIndex.value) return;
  selectedPuzzleIndex.value = nextIndex;
  const definition = localizedPuzzles.value[nextIndex]?.definition;
  if (definition) {
    window.history.pushState(
      { puzzle: definition.id },
      '',
      puzzleHref(window.location.href, definition.id),
    );
  }
}

function retryPuzzleAssets(): void {
  if (selectedPuzzleNeedsDiscovery.value) void discovery.ensureRelationships();
  const profile = selectedPuzzle.value.definition.historicalUnicodeProfile;
  if (profile) void engine.loadHistoricalProfile(profile);
}

async function openDiscovery(): Promise<void> {
  discoveryReturnFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  discoveryOpen.value = true;
  void discovery.ensureRelationships();
  await nextTick();
  closeDiscoveryButton.value?.focus();
}

async function closeDiscovery(): Promise<void> {
  if (!discoveryOpen.value) return;
  discoveryOpen.value = false;
  document.body.style.overflow = previousBodyOverflow;
  await nextTick();
  const returnTarget = discoveryReturnFocus?.isConnected
    ? discoveryReturnFocus
    : document.getElementById('open-character-lab');
  returnTarget?.focus();
  discoveryReturnFocus = null;
}

function handleDiscoveryKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    void closeDiscovery();
    return;
  }
  if (event.key !== 'Tab') return;

  const overlay = discoveryOverlay.value;
  if (!overlay) return;
  const focusable = Array.from(
    overlay.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getClientRects().length > 0);
  if (!focusable.length) {
    event.preventDefault();
    overlay.focus();
    return;
  }

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function syncPuzzleFromLocation(): void {
  selectedPuzzleIndex.value = puzzleIndexFromSearch(
    window.location.search,
    puzzleDefinitions.value,
  );
}

function changeLocale(event: Event): void {
  setLocale((event.target as HTMLSelectElement).value as AppLocale);
}

onMounted(() => window.addEventListener('popstate', syncPuzzleFromLocation));
onBeforeUnmount(() => {
  window.removeEventListener('popstate', syncPuzzleFromLocation);
  document.body.style.overflow = previousBodyOverflow;
});

watch(
  [() => engine.status.value, graphemes],
  ([status, currentGraphemes]) => {
    if (status === 'ready' && explorer.historyLength.value === 0 && currentGraphemes.length) {
      inspectGrapheme(currentGraphemes[0]);
    }
  },
  { immediate: true },
);
</script>

<template>
  <main :inert="discoveryOpen">
    <header class="site-header">
      <a class="wordmark" :href="homeHref" :aria-label="t('app.home')">unicodd<span>·</span></a>
      <p>{{ t('app.tagline') }}</p>
      <div class="site-actions">
        <label class="locale-picker">
          <span class="visually-hidden">{{ t('app.language') }}</span>
          <select :value="locale" :aria-label="t('app.language')" @change="changeLocale">
            <option v-for="item in supportedLocales" :key="item" :value="item">
              {{ item === 'en' ? 'English' : '简体中文' }}
            </option>
          </select>
        </label>
        <button
          type="button"
          :aria-expanded="guideOpen"
          aria-controls="play-guide"
          @click="guideOpen = !guideOpen"
        >
          {{ t('app.howToPlay') }}
        </button>
        <span class="milestone-label">
          {{ String(selectedPuzzle.definition.number).padStart(2, '0') }} /
          {{ localizedPuzzles.length }}
        </span>
      </div>
    </header>

    <aside v-show="guideOpen" id="play-guide" class="play-guide" aria-labelledby="play-guide-title">
      <div>
        <p class="eyebrow">{{ t('guide.eyebrow') }}</p>
        <h2 id="play-guide-title">{{ t('guide.title') }}</h2>
      </div>
      <ol>
        <li>
          <strong>{{ t('guide.construct') }}</strong
          ><span>{{ t('guide.constructDetail') }}</span>
        </li>
        <li>
          <strong>{{ t('guide.inspect') }}</strong
          ><span>{{ t('guide.inspectDetail') }}</span>
        </li>
        <li>
          <strong>{{ t('guide.apply') }}</strong
          ><span>{{ t('guide.applyDetail') }}</span>
        </li>
        <li>
          <strong>{{ t('guide.observe') }}</strong
          ><span>{{ t('guide.observeDetail') }}</span>
        </li>
      </ol>
      <button type="button" :aria-label="t('guide.dismiss')" @click="guideOpen = false">×</button>
    </aside>

    <PuzzleView
      :definition="selectedPuzzle.definition"
      :puzzles="puzzleDefinitions"
      :selected-index="selectedPuzzleIndex"
      :inputs="preparedInputs"
      :explored-target="explorer.target.value"
      :evaluation="puzzleEvaluation"
      :engine-status="engine.status.value"
      :explorer-open="discoveryOpen"
      @update-input="updatePuzzleInput"
      @use-explored="useExploredTarget"
      @open-explorer="openDiscovery"
      @select-puzzle="selectPuzzle"
    />

    <CircuitView
      v-if="puzzleGraph"
      :graph="puzzleGraph"
      :source-values="puzzleSources"
      :error="puzzleError"
      :title="selectedPuzzle.definition.graphTitle"
      :description="selectedPuzzle.definition.graphDescription"
    />
    <section v-else class="panel graph-panel graph-loading" aria-live="polite">
      <template v-if="puzzleError">
        <p class="error-message" role="alert">{{ puzzleError }}</p>
        <button
          v-if="selectedPuzzleNeedsDiscovery || selectedPuzzle.definition.historicalUnicodeProfile"
          type="button"
          @click="retryPuzzleAssets"
        >
          {{ t('graph.retry') }}
        </button>
      </template>
      <p v-else>{{ t('graph.loading') }}</p>
    </section>
  </main>

  <Teleport to="body">
    <div
      v-show="discoveryOpen"
      class="discovery-backdrop"
      @click.self="closeDiscovery"
      @keydown="handleDiscoveryKeydown"
    >
      <section
        id="discovery-workspace"
        ref="discoveryOverlay"
        class="discovery-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discovery-heading"
        aria-describedby="discovery-description"
        tabindex="-1"
      >
        <div class="discovery-toolbar">
          <div>
            <p class="eyebrow">{{ t('lab.eyebrow') }}</p>
            <h2 id="discovery-heading">{{ t('lab.title') }}</h2>
            <p id="discovery-description">{{ t('lab.description') }}</p>
          </div>
          <div class="discovery-toolbar-actions">
            <span class="discovery-target" :aria-label="t('lab.currentTarget')">
              {{ displaySequence(explorer.target.value) }}
            </span>
            <button ref="closeDiscoveryButton" type="button" @click="closeDiscovery">
              {{ t('lab.close') }}
            </button>
          </div>
        </div>

        <div class="workspace" :aria-label="t('lab.workspace')">
          <UnicodeEditor
            v-model="editor.text.value"
            :scalars="editor.scalars.value"
            :graphemes="graphemes"
            :selection="editor.selection.value"
            :selection-revision="editor.selectionRevision.value"
            :error="editor.validationError.value"
            @selection-change="inspectSelection"
            @inspect-grapheme="inspectGrapheme"
          />
          <CharacterExplorer
            :target="explorer.target.value"
            :canonical="explorer.canonical.value"
            :compatibility="explorer.compatibility.value"
            :names="explorer.names.value"
            :grapheme-count="explorer.graphemeCount.value"
            :status="engine.status.value"
            :engine-id="engine.engineId.value"
            :error="engine.error.value"
            :history="explorer.history.value"
            :history-visible="discoveryOpen"
            :properties="discovery.properties.value"
            :relationship-groups="discovery.relationships.value"
            :discovery-status="discovery.status.value"
            :discovery-error="discovery.error.value"
            :discovery-unicode-version="discovery.unicodeVersion.value"
            :discovery-uts39-version="discovery.uts39Version.value"
            :search-results="discovery.searchResults.value"
            :search-status="discovery.searchStatus.value"
            :search-error="discovery.searchError.value"
            @explore="exploreRelated"
            @edit="editWithTarget"
            @activate-history="explorer.activate"
            @search="discovery.search"
            @retry-discovery="discovery.ensureRelationships"
            @insert-discovered="insertDiscovered"
          />
        </div>
      </section>
    </div>
  </Teleport>
</template>
