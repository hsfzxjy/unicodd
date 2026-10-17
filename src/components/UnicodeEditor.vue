<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { selectionContainsRange } from '../explorer/graphemes';
import type { GraphemeRange, TextSelection } from '../explorer/types';
import { displaySequence } from '../unicode';

const props = defineProps<{
  modelValue: string;
  scalars: Uint32Array;
  graphemes: GraphemeRange[];
  selection: TextSelection;
  selectionRevision: number;
  error: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  selectionChange: [selection: TextSelection];
  inspectGrapheme: [grapheme: GraphemeRange];
}>();

const input = ref<HTMLTextAreaElement>();
const scalarCount = computed(() => props.scalars.length);
const graphemeCount = computed(() => props.graphemes.length);

function reportSelection(): void {
  const element = input.value;
  if (!element) return;
  emit('selectionChange', {
    start: element.selectionStart,
    end: element.selectionEnd,
  });
}

function handleInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
  void nextTick(reportSelection);
}

watch(
  () => props.selectionRevision,
  async () => {
    await nextTick();
    input.value?.focus();
    input.value?.setSelectionRange(props.selection.start, props.selection.end);
  },
);
</script>

<template>
  <section class="panel editor-panel" aria-labelledby="editor-heading">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Constructed string</p>
        <h2 id="editor-heading">Build the text to investigate</h2>
      </div>
      <div class="representation-counts" aria-label="String representation counts">
        <span>{{ graphemeCount }} grapheme{{ graphemeCount === 1 ? '' : 's' }}</span>
        <span>{{ scalarCount }} scalar{{ scalarCount === 1 ? '' : 's' }}</span>
        <span>{{ modelValue.length }} UTF-16 unit{{ modelValue.length === 1 ? '' : 's' }}</span>
      </div>
    </div>

    <label class="visually-hidden" for="unicode-input">Unicode text</label>
    <textarea
      id="unicode-input"
      ref="input"
      :value="modelValue"
      rows="3"
      spellcheck="false"
      autocomplete="off"
      aria-describedby="editor-help"
      @input="handleInput"
      @click="reportSelection"
      @keyup="reportSelection"
    />
    <p id="editor-help" class="supporting-copy">
      Type, paste, or select normally. A selection opens exactly that sequence; a caret opens its
      grapheme cluster. Text is never normalized automatically.
    </p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>

    <div v-if="graphemes.length" class="grapheme-strip" aria-label="Grapheme clusters in the input">
      <button
        v-for="grapheme in graphemes"
        :key="`${grapheme.index}-${grapheme.scalarStart}-${grapheme.scalarEnd}`"
        type="button"
        class="grapheme-chip"
        :class="{ selected: selectionContainsRange(selection, grapheme) }"
        :aria-pressed="selectionContainsRange(selection, grapheme)"
        @click="emit('inspectGrapheme', grapheme)"
      >
        <span class="grapheme-glyph">{{ displaySequence(grapheme.scalars) }}</span>
        <span>G{{ grapheme.index + 1 }}</span>
        <span>{{ grapheme.scalars.length }}S</span>
      </button>
    </div>
    <div v-else class="empty-state">Enter text to reveal its grapheme clusters.</div>
  </section>
</template>
