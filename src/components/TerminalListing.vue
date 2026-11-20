<script setup lang="ts">
import { computed } from 'vue'
import { linkStatus, type Action, type Output, type Session } from '../lib/runtime'

const props = defineProps<{
  row: Extract<Output, { kind: 'listing' }>
  activity: Pick<Session, 'visitedHosts' | 'readMail' | 'readResources'>
  prompt: string
  connected: boolean
  busy: boolean
}>()
const emit = defineEmits<{ action: [Action] }>()
const links = computed(() =>
  props.row.links.map((link) => ({ ...link, status: linkStatus(link, props.activity) })),
)
</script>

<template>
  <div class="terminal-list" tabindex="-1">
    <p class="listing-path">
      <bdi>{{ row.path ?? row.title ?? 'Known hosts' }}</bdi>
    </p>
    <p v-if="!row.links.length" class="meta">{{ row.empty ?? 'Empty directory.' }}</p>
    <ul v-else>
      <li v-for="(link, index) in links" :key="index" :data-status="link.status">
        <button
          type="button"
          class="terminal-link"
          :aria-disabled="busy || undefined"
          :disabled="link.action.type === 'connect' && connected && link.action.host === prompt"
          @click="emit('action', link.action)"
        >
          <bdi>{{ link.label }}</bdi>
        </button>
        <span v-if="link.detail || link.tracking" class="listing-detail">
          <bdi v-if="link.detail">{{ link.detail }}</bdi>
          <template v-if="link.status">
            {{ link.detail ? ' · ' : '' }}
            <span class="listing-status">{{ link.status }}</span>
          </template>
        </span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.listing-path {
  color: var(--muted);
  font-size: var(--transcript-meta-size, 12px);
}
.terminal-list {
  margin-top: 3px;
}
.terminal-list ul {
  list-style: none;
  padding: 0;
}
.terminal-list li {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  column-gap: 10px;
}
.listing-detail {
  color: var(--muted);
  font-size: var(--transcript-meta-size, 12px);
}
.terminal-list li:is([data-status='Unread'], [data-status='New']) :is(button, .listing-status) {
  color: var(--text);
  font-weight: 700;
}
</style>
