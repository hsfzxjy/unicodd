<script setup lang="ts">
import { ref, watch } from 'vue';
import type { EngineStatus } from '../composables/useUnicodeEngine';
import { formatUtf16Units } from '../puzzles/input';
import type { PreparedPuzzleInput, PuzzleDefinition, PuzzleEvaluation } from '../puzzles/types';
import { formatCodePoint } from '../unicode';

const props = defineProps<{
  definition: PuzzleDefinition;
  puzzles: PuzzleDefinition[];
  selectedIndex: number;
  inputs: PreparedPuzzleInput[];
  exploredTarget: Uint32Array;
  evaluation: PuzzleEvaluation | null;
  engineStatus: EngineStatus;
  explorerOpen: boolean;
}>();

const emit = defineEmits<{
  updateInput: [id: string, value: string];
  useExplored: [id: string];
  openExplorer: [];
  selectPuzzle: [index: number];
}>();

const visibleHints = ref(0);

watch(
  () => props.definition.id,
  () => {
    visibleHints.value = 0;
  },
);

function formatInput(input: PreparedPuzzleInput): string {
  if (input.error) return input.error;
  if (input.definition.kind === 'utf16-units') {
    return input.utf16 ? formatUtf16Units(input.utf16) : 'Invalid sequence';
  }
  return input.scalars?.length
    ? Array.from(input.scalars, formatCodePoint).join(' ')
    : 'Empty sequence';
}

function inputStatus(input: PreparedPuzzleInput): { label: string; passed: boolean } {
  if (input.error) return { label: 'Invalid input', passed: false };
  const evaluated = props.evaluation?.inputStatuses[input.definition.id];
  if (evaluated) return evaluated;
  const length =
    input.definition.kind === 'utf16-units' ? input.utf16?.length : input.scalars?.length;
  return { label: length ? `${length} value${length === 1 ? '' : 's'}` : 'Empty', passed: false };
}

function revealHint(): void {
  visibleHints.value = Math.min(visibleHints.value + 1, props.definition.hints.length);
}

function selectPuzzle(event: Event): void {
  emit('selectPuzzle', Number((event.target as HTMLSelectElement).value));
}
</script>

<template>
  <section class="puzzle-shell" aria-labelledby="page-title">
    <div class="puzzle-introduction">
      <div>
        <p class="eyebrow">Puzzle {{ definition.number }} · {{ definition.theme }}</p>
        <h1 id="page-title">{{ definition.title }}</h1>
      </div>
      <p class="puzzle-objective">{{ definition.objective }}</p>
      <div class="puzzle-tools">
        <label class="puzzle-picker-label">
          <span class="visually-hidden">Choose puzzle</span>
          <select :value="selectedIndex" aria-label="Choose puzzle" @change="selectPuzzle">
            <option v-for="(puzzle, index) in puzzles" :key="puzzle.id" :value="index">
              {{ String(puzzle.number).padStart(2, '0') }} · {{ puzzle.theme }}
            </option>
          </select>
        </label>
        <span class="profile-label">{{ definition.defaultUnicodeProfile }}</span>
        <button
          id="open-character-lab"
          type="button"
          :aria-expanded="explorerOpen"
          aria-controls="discovery-workspace"
          @click="emit('openExplorer')"
        >
          Character lab
        </button>
      </div>
    </div>

    <div :class="['puzzle-inputs', `input-count-${inputs.length}`]">
      <article v-for="input in inputs" :key="input.definition.id" class="puzzle-input-card">
        <div class="puzzle-input-heading">
          <label :for="`puzzle-${input.definition.id}`">{{ input.definition.label }}</label>
          <span :class="['check-label', { passed: inputStatus(input).passed }]">
            {{ inputStatus(input).label }}
          </span>
        </div>
        <textarea
          :id="`puzzle-${input.definition.id}`"
          class="puzzle-input"
          :value="input.raw"
          :placeholder="input.definition.placeholder"
          rows="1"
          spellcheck="false"
          :aria-describedby="input.error ? `puzzle-${input.definition.id}-error` : undefined"
          @input="
            emit('updateInput', input.definition.id, ($event.target as HTMLTextAreaElement).value)
          "
        />
        <div class="puzzle-input-meta">
          <code>{{ formatInput(input) }}</code>
          <button
            type="button"
            :disabled="exploredTarget.length === 0"
            @click="emit('useExplored', input.definition.id)"
          >
            Use explored
          </button>
        </div>
        <p
          v-if="input.error"
          :id="`puzzle-${input.definition.id}-error`"
          class="error-message"
          role="alert"
        >
          {{ input.error }}
        </p>
      </article>

      <article class="puzzle-result-card" aria-live="polite">
        <div class="puzzle-input-heading">
          <span>{{ definition.resultLabel }}</span>
          <span :class="['check-label', { passed: evaluation?.success }]">
            {{ evaluation?.status ?? (engineStatus === 'loading' ? 'Loading' : 'Waiting') }}
          </span>
        </div>
        <div v-if="evaluation" class="joined-preview">
          <span>{{ evaluation.preview }}</span>
          <code>{{ evaluation.code }}</code>
        </div>
        <div v-else class="joined-preview pending">
          {{ engineStatus === 'loading' ? 'Loading engine…' : 'Waiting for valid inputs' }}
        </div>
        <ul v-if="evaluation" class="puzzle-checks">
          <li v-for="item in evaluation.checks" :key="item.label" :class="{ passed: item.passed }">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </li>
        </ul>
      </article>
    </div>

    <div v-if="evaluation?.success" class="puzzle-solved" role="status">
      <div>
        <p class="eyebrow">Puzzle solved</p>
        <h2>{{ definition.title }}</h2>
      </div>
      <p>{{ definition.explanation }}</p>
      <dl>
        <div v-for="detail in evaluation.details" :key="detail.label">
          <dt>{{ detail.label }}</dt>
          <dd>
            <code>{{ detail.value }}</code>
          </dd>
        </div>
      </dl>
    </div>
    <div v-else class="hint-row">
      <button type="button" :disabled="visibleHints >= definition.hints.length" @click="revealHint">
        {{ visibleHints ? 'Show next hint' : 'Show a hint' }}
      </button>
      <ol v-if="visibleHints" class="hint-list">
        <li v-for="hint in definition.hints.slice(0, visibleHints)" :key="hint">{{ hint }}</li>
      </ol>
    </div>
  </section>
</template>
