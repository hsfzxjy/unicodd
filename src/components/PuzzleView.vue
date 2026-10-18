<script setup lang="ts">
import { ref, watch } from 'vue';
import type { EngineStatus } from '../composables/useUnicodeEngine';
import { useI18n } from '../i18n';
import { serializeUtf16Units } from '../puzzles/input';
import { moveSequenceValue, removeSequenceValue } from '../puzzles/sequenceEditing';
import type { PreparedPuzzleInput, PuzzleDefinition, PuzzleEvaluation } from '../puzzles/types';
import { displaySequence, formatCodePoint, formatHex, unicodeScalarsToString } from '../unicode';

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
  useExplored: [id: string, insertionIndex: number];
  openExplorer: [];
  selectPuzzle: [index: number];
}>();

const visibleHints = ref(0);
const { t } = useI18n();
const insertionOffsets = ref<Record<string, number>>({});
const draggedValue = ref<{ inputId: string; index: number } | null>(null);

watch(
  () => props.definition.id,
  () => {
    visibleHints.value = 0;
    insertionOffsets.value = {};
  },
);

function inputValues(input: PreparedPuzzleInput): number[] {
  const values = input.definition.kind === 'utf16-units' ? input.utf16 : input.scalars;
  return values ? Array.from(values) : [];
}

function formatBlock(input: PreparedPuzzleInput, value: number): string {
  return input.definition.kind === 'utf16-units' ? formatHex(value, 4) : formatCodePoint(value);
}

function renderedInput(input: PreparedPuzzleInput): string {
  if (input.error) return t('puzzle.invalidInput');
  if (input.scalars) return displaySequence(input.scalars);
  return input.utf16?.length ? t('puzzle.invalidScalarText') : '∅';
}

function sequenceKind(input: PreparedPuzzleInput): string {
  return input.definition.kind === 'utf16-units' ? t('puzzle.utf16Kind') : t('puzzle.scalarKind');
}

function insertionOffset(input: PreparedPuzzleInput): number {
  const length = inputValues(input).length;
  return Math.min(Math.max(insertionOffsets.value[input.definition.id] ?? length, 0), length);
}

function selectInsertionPoint(input: PreparedPuzzleInput, index: number): void {
  insertionOffsets.value = {
    ...insertionOffsets.value,
    [input.definition.id]: Math.min(Math.max(index, 0), inputValues(input).length),
  };
}

function encodeValues(input: PreparedPuzzleInput, values: readonly number[]): string {
  return input.definition.kind === 'utf16-units'
    ? serializeUtf16Units(Uint16Array.from(values))
    : unicodeScalarsToString(Uint32Array.from(values));
}

function updateValues(input: PreparedPuzzleInput, values: readonly number[]): void {
  emit('updateInput', input.definition.id, encodeValues(input, values));
}

function removeValue(input: PreparedPuzzleInput, index: number): void {
  const values = removeSequenceValue(inputValues(input), index);
  selectInsertionPoint(input, Math.min(index, values.length));
  updateValues(input, values);
}

function moveValue(input: PreparedPuzzleInput, sourceIndex: number, targetIndex: number): void {
  const values = inputValues(input);
  if (sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0) return;
  updateValues(input, moveSequenceValue(values, sourceIndex, targetIndex));
  selectInsertionPoint(input, targetIndex + 1);
}

function beginDrag(input: PreparedPuzzleInput, index: number, event: DragEvent): void {
  draggedValue.value = { inputId: input.definition.id, index };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `${input.definition.id}:${index}`);
  }
}

function dropValue(input: PreparedPuzzleInput, targetIndex: number, event: DragEvent): void {
  event.preventDefault();
  const source = draggedValue.value;
  if (source?.inputId === input.definition.id) moveValue(input, source.index, targetIndex);
  draggedValue.value = null;
}

function endDrag(): void {
  draggedValue.value = null;
}

function handleBlockKeydown(input: PreparedPuzzleInput, index: number, event: KeyboardEvent): void {
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    removeValue(input, index);
    return;
  }

  if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
  event.preventDefault();
  const targetIndex = index + (event.key === 'ArrowLeft' ? -1 : 1);
  moveValue(input, index, targetIndex);
}

function inputStatus(input: PreparedPuzzleInput): { label: string; passed: boolean } {
  if (input.error) return { label: t('puzzle.invalidInput'), passed: false };
  const evaluated = props.evaluation?.inputStatuses[input.definition.id];
  if (evaluated) return evaluated;
  const length =
    input.definition.kind === 'utf16-units' ? input.utf16?.length : input.scalars?.length;
  return {
    label: length
      ? t('puzzle.valueCount', { count: length, suffix: length === 1 ? '' : 's' })
      : t('puzzle.empty'),
    passed: false,
  };
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
        <p class="eyebrow">
          {{ t('puzzle.numberTheme', { number: definition.number, theme: definition.theme }) }}
        </p>
        <h1 id="page-title">{{ definition.title }}</h1>
      </div>
      <p class="puzzle-objective">{{ definition.objective }}</p>
      <div class="puzzle-tools">
        <nav class="puzzle-navigation" :aria-label="t('puzzle.navigation')">
          <button
            type="button"
            :disabled="selectedIndex === 0"
            :aria-label="t('puzzle.previous')"
            @click="emit('selectPuzzle', selectedIndex - 1)"
          >
            ←
          </button>
          <label class="puzzle-picker-label">
            <span class="visually-hidden">{{ t('puzzle.choose') }}</span>
            <select :value="selectedIndex" :aria-label="t('puzzle.choose')" @change="selectPuzzle">
              <option v-for="(puzzle, index) in puzzles" :key="puzzle.id" :value="index">
                {{ String(puzzle.number).padStart(2, '0') }} · {{ puzzle.theme }}
              </option>
            </select>
          </label>
          <span class="puzzle-position" aria-live="polite">
            {{ selectedIndex + 1 }}/{{ puzzles.length }}
          </span>
          <button
            type="button"
            :disabled="selectedIndex === puzzles.length - 1"
            :aria-label="t('puzzle.next')"
            @click="emit('selectPuzzle', selectedIndex + 1)"
          >
            →
          </button>
        </nav>
        <span class="profile-label">{{ definition.defaultUnicodeProfile }}</span>
        <button
          id="open-character-lab"
          type="button"
          :aria-expanded="explorerOpen"
          aria-controls="discovery-workspace"
          @click="emit('openExplorer')"
        >
          {{ t('puzzle.characterLab') }}
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
        <div class="puzzle-rendered">
          <span>{{ t('puzzle.rendered') }}</span>
          <output :for="`puzzle-${input.definition.id}`">{{ renderedInput(input) }}</output>
        </div>
        <div class="puzzle-sequence-editor">
          <div
            class="puzzle-sequence"
            role="list"
            :aria-label="`${input.definition.label} ${sequenceKind(input)}`"
          >
            <div
              v-for="(value, index) in inputValues(input)"
              :key="`${index}-${value}`"
              :class="[
                'sequence-block',
                { 'insertion-point': insertionOffset(input) === index + 1 },
              ]"
              role="listitem"
              draggable="true"
              @dragstart="beginDrag(input, index, $event)"
              @dragend="endDrag"
              @dragover.prevent
              @drop.stop="dropValue(input, index, $event)"
            >
              <button
                type="button"
                class="sequence-code"
                :aria-label="
                  t('puzzle.sequenceItem', {
                    value: formatBlock(input, value),
                    index: index + 1,
                    count: inputValues(input).length,
                  })
                "
                :title="t('puzzle.reorderTitle', { value: formatBlock(input, value) })"
                @click="selectInsertionPoint(input, index + 1)"
                @keydown="handleBlockKeydown(input, index, $event)"
              >
                <code>{{ formatBlock(input, value) }}</code>
              </button>
              <div
                v-if="insertionOffset(input) === index + 1"
                class="sequence-move-controls"
                role="group"
                :aria-label="t('puzzle.moveGroup', { value: formatBlock(input, value) })"
                @dragstart.stop.prevent
              >
                <button
                  type="button"
                  class="sequence-move"
                  :disabled="index === 0"
                  :aria-label="t('puzzle.moveLeft', { value: formatBlock(input, value) })"
                  @click.stop="moveValue(input, index, index - 1)"
                >
                  ←
                </button>
                <button
                  type="button"
                  class="sequence-move"
                  :disabled="index === inputValues(input).length - 1"
                  :aria-label="t('puzzle.moveRight', { value: formatBlock(input, value) })"
                  @click.stop="moveValue(input, index, index + 1)"
                >
                  →
                </button>
              </div>
              <button
                type="button"
                class="sequence-delete"
                :aria-label="t('puzzle.delete', { value: formatBlock(input, value) })"
                :title="t('puzzle.deleteValue')"
                @dragstart.stop.prevent
                @click="removeValue(input, index)"
              >
                ×
              </button>
            </div>
            <div v-if="inputValues(input).length === 0" class="sequence-empty-item" role="listitem">
              <button
                type="button"
                class="sequence-empty"
                :class="{ 'insertion-point': insertionOffset(input) === 0 }"
                @click="selectInsertionPoint(input, 0)"
              >
                {{ t('puzzle.empty') }}
              </button>
            </div>
          </div>
          <button
            type="button"
            class="insert-explored"
            :disabled="exploredTarget.length === 0"
            :title="t('puzzle.insertTarget', { position: insertionOffset(input) + 1 })"
            @click="emit('useExplored', input.definition.id, insertionOffset(input))"
          >
            {{ t('puzzle.insertExplored') }}
          </button>
        </div>
        <label class="puzzle-direct-entry" :for="`puzzle-${input.definition.id}`">
          <span>{{
            input.definition.kind === 'utf16-units' ? t('puzzle.hexUnits') : t('puzzle.type')
          }}</span>
          <input
            :id="`puzzle-${input.definition.id}`"
            class="puzzle-input"
            type="text"
            :value="input.raw"
            :placeholder="input.definition.placeholder"
            spellcheck="false"
            :aria-describedby="input.error ? `puzzle-${input.definition.id}-error` : undefined"
            @input="
              emit('updateInput', input.definition.id, ($event.target as HTMLInputElement).value)
            "
          />
        </label>
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
            {{
              evaluation?.status ??
              (engineStatus === 'loading' ? t('puzzle.loading') : t('puzzle.waiting'))
            }}
          </span>
        </div>
        <div v-if="evaluation" class="joined-preview">
          <span>{{ evaluation.preview }}</span>
          <code>{{ evaluation.code }}</code>
        </div>
        <div v-else class="joined-preview pending">
          {{ engineStatus === 'loading' ? t('puzzle.loadingEngine') : t('puzzle.waitingInputs') }}
        </div>
        <ul v-if="evaluation" class="puzzle-checks">
          <li v-for="item in evaluation.checks" :key="item.label" :class="{ passed: item.passed }">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </li>
        </ul>
        <nav class="puzzle-sources" :aria-label="t('puzzle.sources')">
          <span>{{ t('puzzle.sources') }}</span>
          <a
            v-for="reference in definition.references"
            :key="reference.url"
            :href="reference.url"
            target="_blank"
            rel="noreferrer"
          >
            {{ reference.label }}
          </a>
        </nav>
      </article>
    </div>

    <div v-if="evaluation?.success" class="puzzle-solved" role="status">
      <div>
        <p class="eyebrow">{{ t('puzzle.solved') }}</p>
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
        {{ visibleHints ? t('puzzle.showNextHint') : t('puzzle.showHint') }}
      </button>
      <ol v-if="visibleHints" class="hint-list">
        <li v-for="hint in definition.hints.slice(0, visibleHints)" :key="hint">{{ hint }}</li>
      </ol>
    </div>
  </section>
</template>
