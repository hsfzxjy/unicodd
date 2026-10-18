<script setup lang="ts">
import type { DiscoveryStatus } from '../composables/useUnicodeDiscovery';
import type { CharacterRelationship, RelationshipGroup } from '../explorer/discoveryTypes';
import { displaySequence, formatCodePoint } from '../unicode';

defineProps<{
  groups: RelationshipGroup[];
  status: DiscoveryStatus;
  error: string | null;
  unicodeVersion: string | null;
  uts39Version: string | null;
}>();

const emit = defineEmits<{
  explore: [relationship: CharacterRelationship];
  retry: [];
}>();

function formatScalars(target: Uint32Array): string {
  return Array.from(target, formatCodePoint).join(' + ');
}
</script>

<template>
  <section class="explorer-section relations-section" aria-labelledby="relations-heading">
    <div class="section-heading">
      <h3 id="relations-heading">Character relationships</h3>
      <span v-if="unicodeVersion">Unicode {{ unicodeVersion }}</span>
    </div>

    <p v-if="status === 'idle'" class="decomposition-empty">
      Relationship data loads when the character lab opens.
    </p>
    <p v-else-if="status === 'loading'" class="decomposition-empty" role="status">
      Loading relationship indexes…
    </p>
    <div v-else-if="status === 'error'" class="relationship-load-error" role="alert">
      <p class="error-message">{{ error ?? 'Character relationships are unavailable.' }}</p>
      <button type="button" @click="emit('retry')">Retry relationship data</button>
    </div>
    <div v-else class="relationship-groups">
      <article v-for="group in groups" :key="group.id" class="relationship-group">
        <div class="relationship-heading">
          <div>
            <h4>{{ group.title }}</h4>
            <p>{{ group.description }}</p>
          </div>
          <span v-if="group.id === 'confusable' && uts39Version">UTS #39 · {{ uts39Version }}</span>
          <span v-else>{{ group.total }} result{{ group.total === 1 ? '' : 's' }}</span>
        </div>
        <div v-if="group.results.length" class="relationship-results">
          <button
            v-for="relationship in group.results"
            :key="`${group.id}-${Array.from(relationship.target).join('-')}`"
            type="button"
            class="relationship-card"
            @click="emit('explore', relationship)"
          >
            <span class="relationship-preview">{{ displaySequence(relationship.target) }}</span>
            <span class="relationship-copy">
              <strong>{{ relationship.label }}</strong>
              <code>{{ formatScalars(relationship.target) }}</code>
              <small>{{ relationship.name ?? 'Sequence result' }}</small>
              <small>{{ relationship.detail }}</small>
            </span>
          </button>
          <p v-if="group.total > group.results.length" class="result-limit-note">
            Showing {{ group.results.length }} of {{ group.total }} ordered results.
          </p>
        </div>
        <p v-else class="decomposition-empty">No {{ group.title.toLowerCase() }} found.</p>
      </article>
    </div>
  </section>
</template>
