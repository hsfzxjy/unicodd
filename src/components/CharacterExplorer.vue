<script setup lang="ts">
import { computed } from 'vue';
import type { EngineStatus } from '../composables/useUnicodeEngine';
import type { DiscoveryStatus, SearchStatus } from '../composables/useUnicodeDiscovery';
import type {
  CharacterProperties,
  CharacterSearchResult,
  RelationshipGroup,
} from '../explorer/discoveryTypes';
import type { ExplorationRelation, ExplorerHistory } from '../explorer/history';
import type { EditorAction } from '../explorer/types';
import { useI18n } from '../i18n';
import {
  displaySequence,
  formatHex,
  inspectScalar,
  stringToUtf16CodeUnits,
  unicodeScalarsToString,
} from '../unicode';
import CharacterRelations from './CharacterRelations.vue';
import CharacterSearch from './CharacterSearch.vue';
import ExplorerHistoryGraph from './ExplorerHistoryGraph.vue';

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
  history: ExplorerHistory;
  historyVisible: boolean;
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
  explore: [target: Uint32Array, relation: ExplorationRelation];
  edit: [action: EditorAction];
  activateHistory: [nodeId: string];
  search: [query: string];
  retryDiscovery: [];
  insertDiscovered: [target: Uint32Array];
}>();
const { locale, t } = useI18n();

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

function exploreScalar(scalar: number, relation: ExplorationRelation): void {
  emit('explore', Uint32Array.of(scalar), relation);
}
</script>

<template>
  <section class="panel explorer-panel" aria-labelledby="explorer-heading">
    <div class="panel-heading explorer-heading">
      <div>
        <p class="eyebrow">{{ t('explorer.eyebrow') }}</p>
        <h2 id="explorer-heading">{{ t('explorer.title') }}</h2>
      </div>
    </div>

    <div v-if="status === 'loading'" class="empty-state explorer-empty" role="status">
      {{ t('explorer.loading') }}
    </div>
    <div
      v-else-if="status === 'error'"
      class="empty-state explorer-empty error-message"
      role="alert"
    >
      {{ error ?? t('explorer.loadError') }}
    </div>
    <div v-else-if="!target.length" class="empty-state explorer-empty">
      {{ t('explorer.empty') }}
    </div>

    <template v-else>
      <div class="target-summary">
        <div class="character-stage" :aria-label="t('explorer.renderedTarget')">
          {{ displaySequence(target) }}
        </div>
        <div class="target-metrics" :aria-label="t('explorer.targetCounts')">
          <span
            ><strong>{{ graphemeCount }}</strong>
            {{
              locale === 'zh-CN' ? '个字素簇' : `grapheme${graphemeCount === 1 ? '' : 's'}`
            }}</span
          >
          <span
            ><strong>{{ target.length }}</strong>
            {{ locale === 'zh-CN' ? '个标量值' : `scalar${target.length === 1 ? '' : 's'}` }}</span
          >
          <span
            ><strong>{{ utf16Count }}</strong>
            {{
              locale === 'zh-CN' ? '个 UTF-16 码元' : `UTF-16 unit${utf16Count === 1 ? '' : 's'}`
            }}</span
          >
        </div>
      </div>

      <div class="edit-actions" :aria-label="t('explorer.useSequence')">
        <button type="button" @click="emit('edit', 'insert')">{{ t('explorer.insert') }}</button>
        <button type="button" @click="emit('edit', 'replace')">{{ t('explorer.replace') }}</button>
        <button type="button" @click="emit('edit', 'append')">{{ t('explorer.append') }}</button>
      </div>

      <ExplorerHistoryGraph
        v-if="historyVisible"
        :history="history"
        @activate="emit('activateHistory', $event)"
      />

      <section class="explorer-section" aria-labelledby="scalar-details-heading">
        <div class="section-heading">
          <h3 id="scalar-details-heading">{{ t('explorer.scalarValues') }}</h3>
          <span>{{ engineId }}</span>
        </div>
        <div class="scalar-details">
          <button
            v-for="details in scalarDetails"
            :key="`${details.scalar}-${details.index}`"
            type="button"
            class="scalar-detail"
            @click="
              exploreScalar(details.scalar, {
                kind: 'scalar',
                label: locale === 'zh-CN' ? '标量分量' : 'Scalar component',
              })
            "
          >
            <span class="visually-hidden">{{ t('explorer.explore') }} </span>
            <span class="scalar-preview">{{ details.display }}</span>
            <span class="scalar-identity">
              <strong>{{ details.codePoint }}</strong>
              <small>{{ details.name ?? t('explorer.noName') }}</small>
            </span>
            <span class="scalar-encodings">
              <small>UTF-8</small><code>{{ details.utf8 }}</code> <small>UTF-16</small
              ><code>{{ details.utf16 }}</code>
            </span>
            <span v-if="details.properties" class="scalar-properties">
              <span
                ><small>{{ t('explorer.category') }}</small
                >{{ details.properties.generalCategory }}</span
              >
              <span
                ><small>{{ t('explorer.script') }}</small
                >{{ details.properties.script }}</span
              >
              <span
                ><small>{{ t('explorer.age') }}</small
                >{{ details.properties.age }}</span
              >
              <span
                ><small>{{ t('explorer.combiningClass') }}</small
                >{{ details.properties.canonicalCombiningClass }}</span
              >
            </span>
          </button>
        </div>
      </section>

      <section
        class="explorer-section decomposition-grid"
        :aria-label="t('explorer.decomposition')"
      >
        <article>
          <div class="section-heading">
            <h3>{{ t('explorer.canonical') }}</h3>
            <span>NFD</span>
          </div>
          <div v-if="canonical.changed" class="component-list">
            <button
              v-for="(scalar, index) in canonical.result"
              :key="`${scalar}-${index}`"
              type="button"
              class="component-chip"
              @click="
                exploreScalar(scalar, {
                  kind: 'canonical-decomposition',
                  label: locale === 'zh-CN' ? 'NFD 分量' : 'NFD component',
                })
              "
            >
              <span>{{ inspectScalar(scalar).display }}</span>
              <span class="component-identity">
                <code>{{ inspectScalar(scalar).codePoint }}</code>
                <small>{{ canonical.names[index] ?? t('explorer.noAssignedName') }}</small>
              </span>
            </button>
          </div>
          <p v-else class="decomposition-empty">{{ t('explorer.noCanonical') }}</p>
        </article>

        <article>
          <div class="section-heading">
            <h3>{{ t('explorer.compatibility') }}</h3>
            <span>NFKD</span>
          </div>
          <div v-if="compatibility.changed" class="component-list">
            <button
              v-for="(scalar, index) in compatibility.result"
              :key="`${scalar}-${index}`"
              type="button"
              class="component-chip"
              @click="
                exploreScalar(scalar, {
                  kind: 'compatibility-decomposition',
                  label: locale === 'zh-CN' ? 'NFKD 分量' : 'NFKD component',
                })
              "
            >
              <span>{{ inspectScalar(scalar).display }}</span>
              <span class="component-identity">
                <code>{{ inspectScalar(scalar).codePoint }}</code>
                <small>{{ compatibility.names[index] ?? t('explorer.noAssignedName') }}</small>
              </span>
            </button>
          </div>
          <p v-else class="decomposition-empty">{{ t('explorer.noCompatibility') }}</p>
        </article>
      </section>

      <CharacterRelations
        :groups="relationshipGroups"
        :status="discoveryStatus"
        :error="discoveryError"
        :unicode-version="discoveryUnicodeVersion"
        :uts39-version="discoveryUts39Version"
        @explore="emit('explore', $event.target, { kind: $event.kind, label: $event.label })"
        @retry="emit('retryDiscovery')"
      />

      <CharacterSearch
        :results="searchResults"
        :status="searchStatus"
        :error="searchError"
        @search="emit('search', $event)"
        @explore="
          emit('explore', $event, {
            kind: 'search',
            label: locale === 'zh-CN' ? '搜索结果' : 'Search result',
          })
        "
        @insert="emit('insertDiscovered', $event)"
      />
    </template>
  </section>
</template>
