<script setup lang="ts">
import { computed } from 'vue';
import type { EngineStatus } from '../composables/useUnicodeEngine';
import type { DiscoveryStatus, SearchStatus } from '../composables/useUnicodeDiscovery';
import type {
  CharacterProperties,
  CharacterSearchResult,
  RelationshipGroup,
} from '../explorer/discoveryTypes';
import type { EditorAction } from '../explorer/types';
import {
  displaySequence,
  formatHex,
  inspectScalar,
  stringToUtf16CodeUnits,
  unicodeScalarsToString,
} from '../unicode';
import CharacterRelations from './CharacterRelations.vue';
import CharacterSearch from './CharacterSearch.vue';

interface DecompositionResult {
  result: Uint32Array;
  changed: boolean;
  names: Array<string | null>;
}

const props = defineProps<{
  target: Uint32Array;
  canonical: DecompositionResult;
  compatibility: DecompositionResult;
  names: Array<string | null>;
  graphemeCount: number;
  status: EngineStatus;
  engineId: string | null;
  error: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  historyPosition: number;
  historyLength: number;
  properties: Array<CharacterProperties | null>;
  relationshipGroups: RelationshipGroup[];
  discoveryStatus: DiscoveryStatus;
  discoveryError: string | null;
  discoveryUnicodeVersion: string | null;
  discoveryUts39Version: string | null;
  searchResults: CharacterSearchResult[];
  searchStatus: SearchStatus;
  searchError: string | null;
}>();

const emit = defineEmits<{
  explore: [target: Uint32Array];
  edit: [action: EditorAction];
  back: [];
  forward: [];
  search: [query: string];
  insertDiscovered: [target: Uint32Array];
}>();

const text = computed(() => unicodeScalarsToString(props.target));
const utf16Count = computed(() => stringToUtf16CodeUnits(text.value).length);
const scalarDetails = computed(() =>
  Array.from(props.target, (scalar, index) => {
    const details = inspectScalar(scalar);
    return {
      ...details,
      index,
      name: props.names[index] ?? null,
      properties: props.properties[index] ?? null,
      utf8: Array.from(details.utf8Bytes, (byte) => formatHex(byte)).join(' '),
      utf16: Array.from(details.utf16Units, (unit) => formatHex(unit, 4)).join(' '),
    };
  }),
);

function exploreScalar(scalar: number): void {
  emit('explore', Uint32Array.of(scalar));
}
</script>

<template>
  <section class="panel explorer-panel" aria-labelledby="explorer-heading">
    <div class="panel-heading explorer-heading">
      <div>
        <p class="eyebrow">Character explorer</p>
        <h2 id="explorer-heading">Inspect without changing the string</h2>
      </div>
      <div class="history-controls" aria-label="Exploration history">
        <button
          type="button"
          :disabled="!canGoBack"
          aria-label="Previous exploration"
          @click="emit('back')"
        >
          ←
        </button>
        <span>{{ historyPosition }}/{{ historyLength }}</span>
        <button
          type="button"
          :disabled="!canGoForward"
          aria-label="Next exploration"
          @click="emit('forward')"
        >
          →
        </button>
      </div>
    </div>

    <div v-if="status === 'loading'" class="empty-state explorer-empty" role="status">
      Loading the Unicode engine…
    </div>
    <div
      v-else-if="status === 'error'"
      class="empty-state explorer-empty error-message"
      role="alert"
    >
      {{ error ?? 'The Unicode engine could not be loaded.' }}
    </div>
    <div v-else-if="!target.length" class="empty-state explorer-empty">
      Select text or place the caret in a grapheme cluster to begin exploring.
    </div>

    <template v-else>
      <div class="target-summary">
        <div class="character-stage" aria-label="Rendered explorer target">
          {{ displaySequence(target) }}
        </div>
        <div class="target-metrics" aria-label="Explorer target counts">
          <span
            ><strong>{{ graphemeCount }}</strong> grapheme{{ graphemeCount === 1 ? '' : 's' }}</span
          >
          <span
            ><strong>{{ target.length }}</strong> scalar{{ target.length === 1 ? '' : 's' }}</span
          >
          <span
            ><strong>{{ utf16Count }}</strong> UTF-16 unit{{ utf16Count === 1 ? '' : 's' }}</span
          >
        </div>
      </div>

      <div class="edit-actions" aria-label="Use explored sequence in constructed string">
        <button type="button" @click="emit('edit', 'insert')">Insert at cursor</button>
        <button type="button" @click="emit('edit', 'replace')">Replace selection</button>
        <button type="button" @click="emit('edit', 'append')">Append</button>
      </div>

      <section class="explorer-section" aria-labelledby="scalar-details-heading">
        <div class="section-heading">
          <h3 id="scalar-details-heading">Scalar values</h3>
          <span>{{ engineId }}</span>
        </div>
        <div class="scalar-details">
          <button
            v-for="details in scalarDetails"
            :key="`${details.scalar}-${details.index}`"
            type="button"
            class="scalar-detail"
            :aria-label="`Explore ${details.codePoint} ${details.name ?? ''}`"
            @click="exploreScalar(details.scalar)"
          >
            <span class="scalar-preview">{{ details.display }}</span>
            <span class="scalar-identity">
              <strong>{{ details.codePoint }}</strong>
              <small>{{ details.name ?? 'No assigned Unicode name' }}</small>
            </span>
            <span class="scalar-encodings">
              <small>UTF-8</small><code>{{ details.utf8 }}</code> <small>UTF-16</small
              ><code>{{ details.utf16 }}</code>
            </span>
            <span v-if="details.properties" class="scalar-properties">
              <span><small>Category</small>{{ details.properties.generalCategory }}</span>
              <span><small>Script</small>{{ details.properties.script }}</span>
              <span><small>Age</small>{{ details.properties.age }}</span>
              <span
                ><small>Combining class</small
                >{{ details.properties.canonicalCombiningClass }}</span
              >
            </span>
          </button>
        </div>
      </section>

      <section class="explorer-section decomposition-grid" aria-label="Unicode decomposition">
        <article>
          <div class="section-heading">
            <h3>Canonical decomposition</h3>
            <span>NFD</span>
          </div>
          <div v-if="canonical.changed" class="component-list">
            <button
              v-for="(scalar, index) in canonical.result"
              :key="`${scalar}-${index}`"
              type="button"
              class="component-chip"
              @click="exploreScalar(scalar)"
            >
              <span>{{ inspectScalar(scalar).display }}</span>
              <span class="component-identity">
                <code>{{ inspectScalar(scalar).codePoint }}</code>
                <small>{{ canonical.names[index] ?? 'No assigned name' }}</small>
              </span>
            </button>
          </div>
          <p v-else class="decomposition-empty">No canonical decomposition.</p>
        </article>

        <article>
          <div class="section-heading">
            <h3>Compatibility decomposition</h3>
            <span>NFKD</span>
          </div>
          <div v-if="compatibility.changed" class="component-list">
            <button
              v-for="(scalar, index) in compatibility.result"
              :key="`${scalar}-${index}`"
              type="button"
              class="component-chip"
              @click="exploreScalar(scalar)"
            >
              <span>{{ inspectScalar(scalar).display }}</span>
              <span class="component-identity">
                <code>{{ inspectScalar(scalar).codePoint }}</code>
                <small>{{ compatibility.names[index] ?? 'No assigned name' }}</small>
              </span>
            </button>
          </div>
          <p v-else class="decomposition-empty">No additional compatibility decomposition.</p>
        </article>
      </section>

      <CharacterRelations
        :groups="relationshipGroups"
        :status="discoveryStatus"
        :error="discoveryError"
        :unicode-version="discoveryUnicodeVersion"
        :uts39-version="discoveryUts39Version"
        @explore="emit('explore', $event)"
      />

      <CharacterSearch
        :results="searchResults"
        :status="searchStatus"
        :error="searchError"
        @search="emit('search', $event)"
        @explore="emit('explore', $event)"
        @insert="emit('insertDiscovered', $event)"
      />
    </template>
  </section>
</template>
