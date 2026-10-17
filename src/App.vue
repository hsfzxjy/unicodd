<script setup lang="ts">
import CharacterInspector from './components/CharacterInspector.vue';
import CircuitView from './components/CircuitView.vue';
import NormalizationPanel from './components/NormalizationPanel.vue';
import UnicodeEditor from './components/UnicodeEditor.vue';
import { useUnicodeEditor } from './composables/useUnicodeEditor';
import { useUnicodeNormalizer } from './composables/useUnicodeNormalizer';

const editor = useUnicodeEditor('Café ☕️');
const normalizer = useUnicodeNormalizer(editor.scalars);
</script>

<template>
  <main>
    <header class="site-header">
      <a class="wordmark" href="#" aria-label="unicodd home">unicodd<span>·</span></a>
      <p>When text behaves oddly.</p>
      <span class="milestone-label">Unicode engine / 02</span>
    </header>

    <section class="hero" aria-labelledby="page-title">
      <p class="eyebrow">A Unicode puzzle laboratory</p>
      <h1 id="page-title">A character is rarely<br />just a character.</h1>
      <p class="hero-copy">
        Type, select, and follow familiar text through the machinery underneath. Your input stays
        untouched. Every transformation is visible.
      </p>
    </section>

    <section class="workspace" aria-label="Unicode workspace">
      <UnicodeEditor
        v-model="editor.text.value"
        :scalars="editor.scalars.value"
        :selected-scalar-index="editor.selectedScalarIndex.value"
        :error="editor.validationError.value"
        @inspect-offset="editor.inspectAtUtf16Offset"
        @inspect-scalar="editor.selectedScalarIndex.value = $event"
      />
      <CharacterInspector :scalar="editor.selectedScalar.value" />
      <NormalizationPanel
        :status="normalizer.status.value"
        :error="normalizer.error.value"
        :engine-id="normalizer.engineId.value"
        :normalized-text="normalizer.normalizedText.value"
        :normalized-scalars="normalizer.normalizedScalars.value"
      />
      <CircuitView :scalars="editor.scalars.value" :error="editor.validationError.value" />
    </section>

    <footer>
      <p>Unicode shown without guesswork.</p>
      <p>Milestone 2 · ICU4X over raw WASM</p>
    </footer>
  </main>
</template>
