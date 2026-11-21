<script setup lang="ts">
import { ChevronRight, FileText, Folder, Mail, MailOpen, Server } from '@lucide/vue'
import { computed, useId } from 'vue'
import { linkStatus, type Action, type Output, type Session } from '../lib/runtime'

const props = defineProps<{
  row: Extract<Output, { kind: 'listing' }>
  closeout?: 'mail' | 'case'
  activity: Pick<Session, 'visitedHosts' | 'readMail' | 'readResources'>
  prompt: string
  connected: boolean
  busy: boolean
}>()
const emit = defineEmits<{ action: [Action] }>()
const listId = useId()
const links = computed(() =>
  props.row.links.map((link) => {
    const status =
      linkStatus(link, props.activity) ?? (link.tracking?.kind === 'host' ? 'Visited' : undefined)
    const mail = link.tracking?.kind === 'mail' || link.resourceType === 'mail'
    const icon = mail ? (status === 'Unread' ? Mail : MailOpen) : listingIcon(link.action)
    const highlight = status === 'New' || (mail && status === 'Unread')
    return { ...link, status, icon, highlight }
  }),
)

function listingIcon(action: Action) {
  switch (action.type) {
    case 'connect':
      return Server
    case 'ls':
    case 'scenario':
      return Folder
    case 'cat':
      return FileText
    default:
      return ChevronRight
  }
}
</script>

<template>
  <div class="terminal-list" :data-closeout="closeout" tabindex="-1">
    <p :id="listId" class="transcript-label">
      <code v-if="row.path"
        ><bdi>{{ row.path }}</bdi></code
      >
      <bdi v-else>{{ row.title ?? 'Known hosts' }}</bdi>
    </p>
    <p v-if="!row.links.length" class="transcript-detail">{{ row.empty ?? 'Empty directory.' }}</p>
    <ul v-else class="transcript-list" role="list" :aria-labelledby="listId">
      <li
        v-for="(link, index) in links"
        :key="index"
        class="transcript-list-row"
        :class="{ 'listing-unseen': link.highlight }"
        :data-status="link.status"
        :data-tracking="link.tracking?.kind"
      >
        <button
          type="button"
          class="terminal-link listing-link"
          :class="{
            'listing-title': link.tracking?.kind === 'mail' || link.action.type === 'scenario',
          }"
          :aria-describedby="
            [
              link.detail && listId + '-' + index + '-detail',
              link.status && listId + '-' + index + '-status',
            ]
              .filter(Boolean)
              .join(' ') || undefined
          "
          :aria-disabled="busy || undefined"
          :disabled="link.action.type === 'connect' && connected && link.action.host === prompt"
          @click="emit('action', link.action)"
        >
          <span class="listing-icon" aria-hidden="true"><component :is="link.icon" /></span>
          <bdi>{{ link.label }}</bdi>
        </button>
        <span
          v-if="link.detail || link.status"
          :id="listId + '-' + index + '-detail'"
          class="listing-detail"
        >
          <bdi v-if="link.detail">{{ link.detail }}</bdi>
        </span>
        <span :id="listId + '-' + index + '-status'" class="listing-status">{{ link.status }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.terminal-list {
  margin-top: 3px;
}
.listing-link {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: var(--space-2);
  min-width: 0;
  margin-inline-start: 0;
  color: var(--text);
  text-align: start;
  text-decoration: none;
}
.listing-link:only-child {
  grid-column: 1 / -1;
}
.listing-link bdi {
  min-width: 0;
  text-decoration: underline;
  text-decoration-color: var(--muted);
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}
.listing-title {
  font-weight: 600;
}
.listing-icon {
  --icon-size: 13px;
  position: relative;
  flex: none;
  color: var(--muted);
}
.listing-detail {
  color: var(--muted);
  font-size: var(--transcript-meta-size, 12px);
}
.listing-status {
  display: block;
  padding-right: var(--space-2);
  font-size: var(--transcript-meta-size, 12px);
  font-family: var(--sans);
  white-space: nowrap;
}
.listing-unseen {
  --unseen-surface: #1d302b;
  background: var(--unseen-surface);
}
.listing-unseen :is(.listing-link, .listing-status, .listing-icon) {
  color: var(--accent);
  font-weight: 700;
}
.transcript-list-row[data-status='New'] .listing-icon::after {
  position: absolute;
  inset-block-start: 1px;
  inset-inline-end: -2px;
  width: 6px;
  height: 6px;
  border: 1px solid var(--unseen-surface);
  border-radius: 50%;
  background: var(--accent);
  content: '';
}
.transcript-list-row[data-tracking='resource'][data-status='Unread'] .listing-link {
  font-weight: 650;
}
.terminal-list[data-closeout] {
  max-inline-size: 48rem;
  margin-block-start: 0;
  padding-inline-start: calc(4px + var(--space-3));
}
.terminal-list[data-closeout='mail'] {
  border-block-start: 1px solid #62584a;
  padding-block-start: var(--space-1);
}
[data-closeout='mail'] .transcript-list {
  --list-label-width: 60%;
}
[data-closeout='mail'] .listing-title {
  font-weight: 700;
}
[data-closeout='case'] {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 var(--space-2);
}
[data-closeout='case'] > .transcript-label {
  flex: none;
}
[data-closeout='case'] > .transcript-list {
  flex: 1 1 24ch;
}
@media (max-width: 830px) {
  .terminal-list[data-closeout] {
    padding-inline-start: calc(4px + var(--space-2));
  }
}
@media (max-width: 600px) {
  .terminal-list .transcript-list {
    grid-template-columns: minmax(0, 1fr);
  }
  .terminal-list .transcript-list-row {
    display: flex;
    flex-wrap: wrap;
    column-gap: var(--space-2);
  }
  .listing-detail {
    flex: 1 1 12ch;
  }
  .terminal-list[data-closeout='mail'] :is(.transcript-list, .transcript-list-row) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) max-content;
  }
  [data-closeout='mail'] .listing-detail {
    grid-row: 2;
    padding-inline-start: calc(13px + var(--space-2));
    padding-block-end: 3px;
  }
  [data-closeout='mail'] .listing-status {
    grid-column: 2;
    grid-row: 1;
  }
}
</style>
