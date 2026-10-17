<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import CharacterExplorer from './components/CharacterExplorer.vue';
import CircuitView from './components/CircuitView.vue';
import PuzzleView from './components/PuzzleView.vue';
import UnicodeEditor from './components/UnicodeEditor.vue';
import { useCharacterExplorer } from './composables/useCharacterExplorer';
import { useUnicodeEditor } from './composables/useUnicodeEditor';
import { useUnicodeDiscovery } from './composables/useUnicodeDiscovery';
import { useUnicodeEngine } from './composables/useUnicodeEngine';
import type { OperationValue } from './engine/types';
import { buildGraphemeRanges, scalarBoundaries, targetForSelection } from './explorer/graphemes';
import type { ExplorationRelation } from './explorer/history';
import type { EditorAction, GraphemeRange, TextSelection } from './explorer/types';
import {
  createNormalizationPuzzleGraph,
  evaluateNormalizationPuzzle,
  normalizationConcatenationPuzzle,
} from './puzzles/normalizationConcatenation';
import { displaySequence, unicodeScalarsToString } from './unicode';

const editor = useUnicodeEditor('é');
const leftInput = useUnicodeEditor(
  normalizationConcatenationPuzzle.inputs.find(({ id }) => id === 'left')?.initialValue ?? '',
);
const rightInput = useUnicodeEditor(
  normalizationConcatenationPuzzle.inputs.find(({ id }) => id === 'right')?.initialValue ?? '',
);
const engine = useUnicodeEngine();
const explorer = useCharacterExplorer(engine.adapter);
const discovery = useUnicodeDiscovery(engine.adapter, explorer.target);
const discoveryOpen = ref(false);
const closeDiscoveryButton = ref<HTMLButtonElement | null>(null);

const graphemeBoundaries = computed(() =>
  engine.adapter.value
    ? engine.adapter.value.graphemeBoundaries(editor.scalars.value)
    : scalarBoundaries(editor.scalars.value),
);
const graphemes = computed(() =>
  buildGraphemeRanges(editor.scalars.value, graphemeBoundaries.value),
);
const puzzleEvaluation = computed(() => {
  const adapter = engine.adapter.value;
  if (leftInput.validationError.value || rightInput.validationError.value || !adapter) return null;
  return evaluateNormalizationPuzzle(leftInput.scalars.value, rightInput.scalars.value, (input) =>
    adapter.normalize('NFC', input),
  );
});
const puzzleGraph = computed(() => {
  const adapter = engine.adapter.value;
  return adapter
    ? createNormalizationPuzzleGraph((input) => adapter.normalize('NFC', input))
    : null;
});
const puzzleSources = computed<Readonly<Record<string, OperationValue>>>(() => ({
  left: { kind: 'scalars', value: leftInput.scalars.value },
  right: { kind: 'scalars', value: rightInput.scalars.value },
}));
const puzzleError = computed(
  () => leftInput.validationError.value ?? rightInput.validationError.value ?? engine.error.value,
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

function useExploredTarget(input: 'left' | 'right'): void {
  const value = unicodeScalarsToString(explorer.target.value);
  if (input === 'left') leftInput.text.value = value;
  else rightInput.text.value = value;
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
      <span class="milestone-label">Puzzle 01 · Milestone 5</span>
    </header>

    <PuzzleView
      :definition="normalizationConcatenationPuzzle"
      :left-text="leftInput.text.value"
      :right-text="rightInput.text.value"
      :left-scalars="leftInput.scalars.value"
      :right-scalars="rightInput.scalars.value"
      :left-error="leftInput.validationError.value"
      :right-error="rightInput.validationError.value"
      :explored-target="explorer.target.value"
      :evaluation="puzzleEvaluation"
      :engine-status="engine.status.value"
      :explorer-open="discoveryOpen"
      @update:left-text="leftInput.text.value = $event"
      @update:right-text="rightInput.text.value = $event"
      @use-explored="useExploredTarget"
      @open-explorer="openDiscovery"
    />

    <CircuitView
      v-if="puzzleGraph"
      :graph="puzzleGraph"
      :source-values="puzzleSources"
      :error="puzzleError"
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
