<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
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
import { puzzleCollection } from './puzzles/collection';
import { formatUtf16Units, preparePuzzleInput } from './puzzles/input';
import type { PreparedPuzzleInput, PuzzleOperations } from './puzzles/types';
import { displaySequence, stringToUtf16CodeUnits, unicodeScalarsToString } from './unicode';

const editor = useUnicodeEditor('é');
const engine = useUnicodeEngine();
const explorer = useCharacterExplorer(engine.adapter);
const discovery = useUnicodeDiscovery(engine.adapter, explorer.target);
const discoveryOpen = ref(false);
const closeDiscoveryButton = ref<HTMLButtonElement | null>(null);
const selectedPuzzleIndex = ref(0);
const puzzleDefinitions = puzzleCollection.map(({ definition }) => definition);
const puzzleValues = reactive(
  Object.fromEntries(
    puzzleCollection.map(({ definition }) => [
      definition.id,
      Object.fromEntries(definition.inputs.map((input) => [input.id, input.initialValue])),
    ]),
  ) as Record<string, Record<string, string>>,
);

const selectedPuzzle = computed(
  () => puzzleCollection[selectedPuzzleIndex.value] ?? puzzleCollection[0]!,
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
  if (!adapter || !index || (historicalProfile && !historicalAdapter)) return null;
  return {
    normalize: (form, input) => adapter.normalize(form, input),
    caseFold: (input) => adapter.caseFold(input),
    graphemeBoundaries: (input) => adapter.graphemeBoundaries(input),
    confusableSkeleton: (input) =>
      index.confusableSkeleton(input, (value) => adapter.normalize('NFD', value)),
    generalCategory: (scalar) => index.propertiesFor(scalar)?.generalCategory ?? null,
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
const puzzleError = computed(
  () =>
    preparedInputs.value.find(({ error }) => error)?.error ??
    engine.error.value ??
    (selectedPuzzle.value.definition.historicalUnicodeProfile
      ? engine.historicalError.value
      : null) ??
    discovery.error.value,
);

watch(
  () => selectedPuzzle.value.definition.historicalUnicodeProfile,
  (profile) => {
    if (profile) void engine.loadHistoricalProfile(profile);
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
      explorer.explore(target, { kind: 'selection', label: 'Selected from string' });
    }
  } catch {
    // Browser selections can bisect a surrogate pair. Preserve that editor selection without
    // replacing the valid explorer target with malformed UTF-16.
  }
}

function inspectGrapheme(grapheme: GraphemeRange): void {
  editor.selectRange({ start: grapheme.utf16Start, end: grapheme.utf16End });
  explorer.explore(grapheme.scalars, { kind: 'selection', label: 'Selected from string' });
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

function useExploredTarget(id: string): void {
  const input = selectedPuzzle.value.definition.inputs.find((candidate) => candidate.id === id);
  if (!input) return;
  const value =
    input.kind === 'utf16-units'
      ? formatUtf16Units(stringToUtf16CodeUnits(unicodeScalarsToString(explorer.target.value)))
      : unicodeScalarsToString(explorer.target.value);
  updatePuzzleInput(id, value);
}

function selectPuzzle(index: number): void {
  selectedPuzzleIndex.value = Math.min(Math.max(index, 0), puzzleCollection.length - 1);
}

async function openDiscovery(): Promise<void> {
  discoveryOpen.value = true;
  await nextTick();
  closeDiscoveryButton.value?.focus();
}

async function closeDiscovery(): Promise<void> {
  discoveryOpen.value = false;
  await nextTick();
  document.getElementById('open-character-lab')?.focus();
}

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
      <a class="wordmark" href="#" aria-label="unicodd home">unicodd<span>·</span></a>
      <p>When text behaves oddly.</p>
      <span class="milestone-label">
        Puzzle {{ String(selectedPuzzle.definition.number).padStart(2, '0') }} /
        {{ puzzleCollection.length }} · Milestone 7
      </span>
    </header>

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
    <section v-else class="panel graph-panel" aria-live="polite">
      Loading the operation graph…
    </section>
  </main>

  <Teleport to="body">
    <div
      v-show="discoveryOpen"
      class="discovery-backdrop"
      @click.self="closeDiscovery"
      @keydown.esc="closeDiscovery"
    >
      <section
        id="discovery-workspace"
        class="discovery-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discovery-heading"
      >
        <div class="discovery-toolbar">
          <div>
            <p class="eyebrow">Character lab</p>
            <h2 id="discovery-heading">Discover before you construct</h2>
            <p>
              Inspect decomposition and relatives. The puzzle changes only when you explicitly use a
              discovered sequence.
            </p>
          </div>
          <div class="discovery-toolbar-actions">
            <span class="discovery-target" aria-label="Current explorer target">
              {{ displaySequence(explorer.target.value) }}
            </span>
            <button ref="closeDiscoveryButton" type="button" @click="closeDiscovery">
              Close lab
            </button>
          </div>
        </div>

        <div class="workspace" aria-label="Unicode editor and character explorer">
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
            @insert-discovered="insertDiscovered"
          />
        </div>
      </section>
    </div>
  </Teleport>
</template>
