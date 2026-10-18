<script setup lang="ts">
import { ref } from 'vue';
import type { SearchStatus } from '../composables/useUnicodeDiscovery';
import type { CharacterSearchResult } from '../explorer/discoveryTypes';
import { useI18n } from '../i18n';
import { displaySequence, formatCodePoint } from '../unicode';

defineProps<{
  results: CharacterSearchResult[];
  status: SearchStatus;
  error: string | null;
}>();

const emit = defineEmits<{
  search: [query: string];
  explore: [target: Uint32Array];
  insert: [target: Uint32Array];
}>();

const query = ref('');
const { t } = useI18n();

function submit(): void {
  emit('search', query.value);
}

function formatScalars(target: Uint32Array): string {
  return Array.from(target, formatCodePoint).join(' + ');
}
</script>

<template>
  <section class="explorer-section search-section" aria-labelledby="search-heading">
    <div class="section-heading">
      <div>
        <h3 id="search-heading">{{ t('search.title') }}</h3>
        <p>{{ t('search.description') }}</p>
      </div>
      <span>{{ t('search.onDemand') }}</span>
    </div>
    <form class="character-search" role="search" @submit.prevent="submit">
      <label class="visually-hidden" for="character-search-input">{{ t('search.label') }}</label>
      <input
        id="character-search-input"
        v-model="query"
        type="search"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('search.placeholder')"
      />
      <button type="submit" :disabled="status === 'loading' || !query.trim()">
        {{ status === 'loading' ? t('search.searching') : t('search.action') }}
      </button>
    </form>
    <p v-if="status === 'error'" class="error-message" role="alert">
      {{ error ?? t('search.error') }}
    </p>
    <div v-else-if="status === 'ready' && results.length" class="search-results" aria-live="polite">
      <article
        v-for="result in results"
        :key="`${result.match}-${Array.from(result.target).join('-')}`"
        class="search-result"
      >
        <button type="button" class="search-result-main" @click="emit('explore', result.target)">
          <span>{{ displaySequence(result.target) }}</span>
          <span>
            <code>{{ formatScalars(result.target) }}</code>
            <small>{{ result.name ?? t('search.sequence') }}</small>
          </span>
        </button>
        <button type="button" class="search-insert" @click="emit('insert', result.target)">
          {{ t('search.insert') }}
        </button>
      </article>
    </div>
    <p v-else-if="status === 'ready'" class="decomposition-empty" aria-live="polite">
      {{ t('search.none') }}
    </p>
  </section>
</template>
