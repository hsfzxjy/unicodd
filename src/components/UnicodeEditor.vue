<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatCodePoint } from '../unicode';

const props = defineProps<{
  modelValue: string;
  scalars: Uint32Array;
  selectedScalarIndex: number | null;
  error: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  inspectOffset: [offset: number];
  inspectScalar: [index: number];
}>();

const input = ref<HTMLTextAreaElement>();
const scalarCount = computed(() => props.scalars.length);

function handleInspection(): void {
  emit('inspectOffset', input.value?.selectionStart ?? 0);
}
</script>

<template>
  <section class="panel editor-panel" aria-labelledby="editor-heading">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Constructed string</p>
        <h2 id="editor-heading">Type something familiar.</h2>
      </div>
      <span class="count-badge">{{ scalarCount }} scalar{{ scalarCount === 1 ? '' : 's' }}</span>
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
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      @click="handleInspection"
      @keyup="handleInspection"
      @select="handleInspection"
    />
    <p id="editor-help" class="supporting-copy">
      Text stays exactly as entered. Select in the field or choose a scalar below to inspect it.
    </p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>

    <div v-if="scalars.length" class="scalar-strip" aria-label="Unicode scalars in the input">
      <button
        v-for="(scalar, index) in scalars"
        :key="`${index}-${scalar}`"
        type="button"
        class="scalar-chip"
        :class="{ selected: selectedScalarIndex === index }"
        :aria-pressed="selectedScalarIndex === index"
        @click="emit('inspectScalar', index)"
      >
        <span class="scalar-glyph">{{ String.fromCodePoint(scalar) }}</span>
        <span>{{ formatCodePoint(scalar) }}</span>
      </button>
    </div>
    <div v-else class="empty-state">Enter text to reveal its scalar values.</div>
  </section>
</template>
