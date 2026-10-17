<script setup lang="ts">
import { computed, watch } from 'vue';
import CharacterExplorer from './components/CharacterExplorer.vue';
import CircuitView from './components/CircuitView.vue';
import UnicodeEditor from './components/UnicodeEditor.vue';
import { useCharacterExplorer } from './composables/useCharacterExplorer';
import { useUnicodeEditor } from './composables/useUnicodeEditor';
import { useUnicodeEngine } from './composables/useUnicodeEngine';
import { buildGraphemeRanges, scalarBoundaries, targetForSelection } from './explorer/graphemes';
import type { EditorAction, GraphemeRange, TextSelection } from './explorer/types';

const editor = useUnicodeEditor('Café ☕️');
const engine = useUnicodeEngine();
const explorer = useCharacterExplorer(engine.adapter);

const graphemeBoundaries = computed(() =>
  engine.adapter.value
    ? engine.adapter.value.graphemeBoundaries(editor.scalars.value)
    : scalarBoundaries(editor.scalars.value),
);
const graphemes = computed(() =>
  buildGraphemeRanges(editor.scalars.value, graphemeBoundaries.value),
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
    // Browser selections can bisect a surrogate pair. Keep the editor selection, but do not
    // replace the valid explorer target with a malformed UTF-16 fragment.
  }
}

function inspectGrapheme(grapheme: GraphemeRange): void {
  editor.selectRange({ start: grapheme.utf16Start, end: grapheme.utf16End });
  explorer.explore(grapheme.scalars);
}

function editWithTarget(action: EditorAction): void {
  editor.applyScalars(explorer.target.value, action);
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
      <span class="milestone-label">Character explorer / 03</span>
    </header>

    <section class="objective" aria-labelledby="page-title">
      <p class="eyebrow">Workspace objective</p>
      <div>
        <h1 id="page-title">Take a familiar character apart.</h1>
        <p>
          Select a grapheme, inspect its scalar representations, and follow canonical or
          compatibility decomposition without changing the string until you choose an edit.
        </p>
      </div>
    </section>

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
        @explore="explorer.explore"
        @edit="editWithTarget"
        @back="explorer.back"
        @forward="explorer.forward"
      />
    </section>

    <CircuitView :scalars="editor.scalars.value" :error="editor.validationError.value" />

    <footer>
      <p>Unicode shown without guesswork.</p>
      <p>Milestone 3 · ICU4X exploration</p>
    </footer>
  </main>
</template>
