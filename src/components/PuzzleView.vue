<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EngineStatus } from '../composables/useUnicodeEngine';
import type { PuzzleDefinition, NormalizationPuzzleEvaluation } from '../puzzles/types';
import { displaySequence, formatCodePoint } from '../unicode';

const props = defineProps<{
  definition: PuzzleDefinition;
  leftText: string;
  rightText: string;
  leftScalars: Uint32Array;
  rightScalars: Uint32Array;
  leftError: string | null;
  rightError: string | null;
  exploredTarget: Uint32Array;
  evaluation: NormalizationPuzzleEvaluation | null;
  engineStatus: EngineStatus;
}>();

const emit = defineEmits<{
  'update:leftText': [value: string];
  'update:rightText': [value: string];
  useExplored: [input: 'left' | 'right'];
  openExplorer: [];
}>();

const visibleHints = ref(0);
const inputDefinitions = computed(() =>
  Object.fromEntries(props.definition.inputs.map((input) => [input.id, input])),
);

function formatScalars(scalars: Uint32Array): string {
  return scalars.length ? Array.from(scalars, formatCodePoint).join(' ') : 'Empty sequence';
}

function revealHint(): void {
  visibleHints.value = Math.min(visibleHints.value + 1, props.definition.hints.length);
}
</script>

<template>
  <section class="puzzle-shell" aria-labelledby="page-title">
    <div class="puzzle-introduction">
      <div>
        <p class="eyebrow">Puzzle 01 · Normalization</p>
        <h1 id="page-title">{{ definition.title }}</h1>
      </div>
      <p class="puzzle-objective">{{ definition.objective }}</p>
      <div class="puzzle-tools">
        <span class="profile-label">{{ definition.defaultUnicodeProfile }}</span>
        <button type="button" @click="emit('openExplorer')">Open character lab</button>
      </div>
    </div>

    <div class="puzzle-inputs">
      <article class="puzzle-input-card">
        <div class="puzzle-input-heading">
          <label for="puzzle-left">{{ inputDefinitions.left?.label }}</label>
          <span
            :class="['check-label', { passed: leftScalars.length > 0 && evaluation?.leftIsNfc }]"
          >
            {{ leftScalars.length === 0 ? 'Empty' : evaluation?.leftIsNfc ? 'NFC ✓' : 'Needs NFC' }}
          </span>
        </div>
        <textarea
          id="puzzle-left"
          class="puzzle-input"
          :value="leftText"
          rows="1"
          spellcheck="false"
          :aria-describedby="leftError ? 'puzzle-left-error' : undefined"
          @input="emit('update:leftText', ($event.target as HTMLTextAreaElement).value)"
        />
        <div class="puzzle-input-meta">
          <code>{{ formatScalars(leftScalars) }}</code>
          <button
            type="button"
            :disabled="exploredTarget.length === 0"
            @click="emit('useExplored', 'left')"
          >
            Use explored sequence
          </button>
        </div>
        <p v-if="leftError" id="puzzle-left-error" class="error-message" role="alert">
          {{ leftError }}
        </p>
      </article>

      <div class="join-symbol" aria-hidden="true">+</div>

      <article class="puzzle-input-card">
        <div class="puzzle-input-heading">
          <label for="puzzle-right">{{ inputDefinitions.right?.label }}</label>
          <span
            :class="['check-label', { passed: rightScalars.length > 0 && evaluation?.rightIsNfc }]"
          >
            {{
              rightScalars.length === 0 ? 'Empty' : evaluation?.rightIsNfc ? 'NFC ✓' : 'Needs NFC'
            }}
          </span>
        </div>
        <textarea
          id="puzzle-right"
          class="puzzle-input"
          :value="rightText"
          rows="1"
          spellcheck="false"
          :aria-describedby="rightError ? 'puzzle-right-error' : undefined"
          @input="emit('update:rightText', ($event.target as HTMLTextAreaElement).value)"
        />
        <div class="puzzle-input-meta">
          <code>{{ formatScalars(rightScalars) }}</code>
          <button
            type="button"
            :disabled="exploredTarget.length === 0"
            @click="emit('useExplored', 'right')"
          >
            Use explored sequence
          </button>
        </div>
        <p v-if="rightError" id="puzzle-right-error" class="error-message" role="alert">
          {{ rightError }}
        </p>
      </article>

      <div class="join-symbol" aria-hidden="true">→</div>

      <article class="puzzle-result-card" aria-live="polite">
        <div class="puzzle-input-heading">
          <span>Concatenation</span>
          <span :class="['check-label', { passed: evaluation && !evaluation.joinedIsNfc }]">
            {{ evaluation && !evaluation.joinedIsNfc ? 'Not NFC ✓' : 'Still NFC' }}
          </span>
        </div>
        <div v-if="evaluation" class="joined-preview">
          <span>{{ displaySequence(evaluation.joined) }}</span>
          <code>{{ formatScalars(evaluation.joined) }}</code>
        </div>
        <div v-else class="joined-preview pending">
          {{ engineStatus === 'loading' ? 'Loading engine…' : 'Waiting for valid inputs' }}
        </div>
      </article>
    </div>

    <div v-if="evaluation?.success" class="puzzle-solved" role="status">
      <div>
        <p class="eyebrow">Puzzle solved</p>
        <h2>The boundary changed the normalization state.</h2>
      </div>
      <p>{{ definition.explanation }}</p>
      <dl>
        <div>
          <dt>Entered</dt>
          <dd>
            <code>{{ formatScalars(evaluation.joined) }}</code>
          </dd>
        </div>
        <div>
          <dt>After NFC</dt>
          <dd>
            <code>{{ formatScalars(evaluation.joinedNormalized) }}</code>
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
