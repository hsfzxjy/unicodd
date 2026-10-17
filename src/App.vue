<script setup lang="ts">
import { computed, watch } from 'vue';
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
import type { EditorAction, GraphemeRange, TextSelection } from './explorer/types';
import {
  createNormalizationPuzzleGraph,
  evaluateNormalizationPuzzle,
  normalizationConcatenationPuzzle,
} from './puzzles/normalizationConcatenation';
import { unicodeScalarsToString } from './unicode';

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
    if (target) explorer.explore(target);
  } catch {
    // Browser selections can bisect a surrogate pair. Preserve that editor selection without
    // replacing the valid explorer target with malformed UTF-16.
  }
}

function inspectGrapheme(grapheme: GraphemeRange): void {
  editor.selectRange({ start: grapheme.utf16Start, end: grapheme.utf16End });
  explorer.explore(grapheme.scalars);
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
  <main>
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
      @update:left-text="leftInput.text.value = $event"
      @update:right-text="rightInput.text.value = $event"
      @use-explored="useExploredTarget"
    />

    <div class="workspace-label">
      <p class="eyebrow">Discovery workspace</p>
      <p>Start from é, inspect its decomposition, then send each component to a puzzle input.</p>
    </div>

    <section class="workspace" aria-label="Unicode editor and character explorer">
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
        :can-go-back="explorer.canGoBack.value"
        :can-go-forward="explorer.canGoForward.value"
        :history-position="explorer.historyPosition.value"
        :history-length="explorer.historyLength.value"
        :properties="discovery.properties.value"
        :relationship-groups="discovery.relationships.value"
        :discovery-status="discovery.status.value"
        :discovery-error="discovery.error.value"
        :discovery-unicode-version="discovery.unicodeVersion.value"
        :discovery-uts39-version="discovery.uts39Version.value"
        :search-results="discovery.searchResults.value"
        :search-status="discovery.searchStatus.value"
        :search-error="discovery.searchError.value"
        @explore="explorer.explore"
        @edit="editWithTarget"
        @back="explorer.back"
        @forward="explorer.forward"
        @search="discovery.search"
        @insert-discovered="insertDiscovered"
      />
    </section>

    <CircuitView
      v-if="puzzleGraph"
      :graph="puzzleGraph"
      :source-values="puzzleSources"
      :error="puzzleError"
    />
    <section v-else class="panel graph-panel" aria-live="polite">
      Loading the operation graph…
    </section>

    <footer>
      <p>Unicode shown without guesswork.</p>
      <p>Milestone 5 · Character discovery</p>
    </footer>
  </main>
</template>
