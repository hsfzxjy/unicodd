<script setup lang="ts">
import {
  ArrowDownToLine,
  Check,
  Flag,
  History,
  ListChecks,
  Mail,
  MailOpen,
  Monitor,
  Server,
  Target,
  Terminal as TerminalIcon,
} from '@lucide/vue'
import { computed, ref, shallowRef, watch } from 'vue'
import type { ScenarioEntry } from '../lib/content'
import type { createRuntime, Session } from '../lib/runtime'
import type { TerminalPanel } from '../lib/workspace'

const props = defineProps<{
  scenarioId: string
  scenarioTitle: string
  destinations: ScenarioEntry[]
  debugSelector?: { label: string; optionSuffix: string }
  session: Session
  hostStatus?: ReturnType<typeof createRuntime>['hostStatus']
  permissionLabel: string
  goalStatus: string
  caseComplete: boolean
  campaignFinished: boolean
  transcriptLive: boolean
  openPanel?: TerminalPanel
  busy: boolean
  newHosts: number
  unreadMail?: number
  following: boolean
  unseenProgress: boolean
}>()
const emit = defineEmits<{
  scenario: [string]
  panel: [TerminalPanel]
  list: ['hosts' | 'mail']
  latest: [MouseEvent]
}>()

const checks = computed(() =>
  (props.hostStatus ?? []).filter(({ reached }) => reached !== undefined),
)
const reachedChecks = computed(() => checks.value.filter(({ reached }) => reached).length)
const progress = computed(() =>
  props.campaignFinished
    ? 'All available scenarios complete'
    : checks.value.length
      ? `${reachedChecks.value} of ${checks.value.length} checks complete`
      : props.session.host
        ? 'Host status'
        : 'No host connected',
)
const titleStatus = computed(() => {
  const { host, identity, completed } = props.session
  const location = host ? '@' + host.id : 'Local console'
  return [
    {
      key: 'goal',
      name: 'Goal: ' + props.goalStatus,
      detail: 'Goal: ' + props.goalStatus,
      icon: completed ? Check : props.caseComplete ? History : Target,
      reached: props.caseComplete,
    },
    {
      key: 'session',
      name: `Session: ${location} ${props.permissionLabel}`,
      detail: `${host ? 'Connected to ' + host.id : 'Local console'}. Signed in as ${identity.user}. Permissions: ${props.permissionLabel}.`,
      icon: host ? TerminalIcon : Monitor,
      reached: Boolean(host && identity.role !== host.guest.role),
    },
    {
      key: 'progress',
      name: 'Progress: ' + progress.value,
      detail: [
        'Progress: ' + progress.value,
        ...(props.hostStatus ?? []).map(({ label, value }) => `${label}: ${value}`),
      ].join('\n'),
      icon: props.campaignFinished ? Flag : ListChecks,
      reached:
        props.campaignFinished ||
        (checks.value.length > 0 && reachedChecks.value === checks.value.length),
    },
  ] as const
})
const changedStatus = shallowRef(new Set<TerminalPanel>())
const statusAnnouncement = ref('')
watch(titleStatus, (current, previous) => {
  if (!props.transcriptLive) {
    changedStatus.value = new Set()
    statusAnnouncement.value = ''
    return
  }
  const changed = current.filter((item, index) => previous[index]?.detail !== item.detail)
  if (changed.length) {
    changedStatus.value = new Set(changed.map(({ key }) => key))
    statusAnnouncement.value = changed.map(({ detail }) => detail).join(' ')
  }
})
</script>

<template>
  <div class="frame-title">
    <span class="wordmark">unicodd</span>
    <h1
      v-if="destinations.length === 1 && !debugSelector"
      class="terminal-scenario"
      :title="scenarioTitle"
    >
      <bdi>{{ scenarioTitle }}</bdi>
    </h1>
    <select
      v-else
      :value="scenarioId"
      class="terminal-scenario"
      :aria-label="debugSelector?.label ?? 'Case'"
      :disabled="busy"
      @change="emit('scenario', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="entry in destinations" :key="entry.id" :value="entry.id">
        {{ entry.label + (debugSelector?.optionSuffix ?? '') }}
      </option>
    </select>
    <div class="title-actions">
      <button
        v-if="!following"
        type="button"
        class="icon-button latest-output"
        :class="{ 'latest-progress': unseenProgress }"
        :aria-label="unseenProgress ? 'Latest output, new milestone' : 'Latest output'"
        :title="unseenProgress ? 'Latest output, new milestone' : 'Latest output'"
        @click="emit('latest', $event)"
      >
        <Flag v-if="unseenProgress" aria-hidden="true" />
        <ArrowDownToLine v-else aria-hidden="true" />
      </button>
      <button
        v-for="item in titleStatus"
        :key="item.key"
        type="button"
        class="icon-button title-status"
        :class="{
          'status-reached': item.reached,
          'status-changing': changedStatus.has(item.key),
        }"
        :aria-label="item.name"
        :title="item.detail"
        :aria-controls="item.key + '-details'"
        :aria-expanded="openPanel === item.key"
        :data-panel="item.key"
        @click="emit('panel', item.key)"
      >
        <component :is="item.icon" :key="item.detail" class="status-mark" aria-hidden="true" />
        <span
          v-if="item.key === 'progress' && checks.length && !campaignFinished"
          class="check-meter"
          aria-hidden="true"
        >
          <span :style="{ inlineSize: `${(100 * reachedChecks) / checks.length}%` }"></span>
        </span>
      </button>
      <button
        type="button"
        class="icon-button title-notification"
        :class="{ 'has-notification': newHosts > 0 }"
        :aria-label="newHosts ? `Open local hosts, ${newHosts} new` : 'Open local hosts'"
        title="Open local hosts"
        :aria-disabled="busy || undefined"
        @click="emit('list', 'hosts')"
      >
        <Server aria-hidden="true" />
        <span v-if="newHosts" class="notification-count" aria-hidden="true">{{ newHosts }}</span>
      </button>
      <button
        v-if="unreadMail !== undefined"
        type="button"
        class="icon-button title-notification"
        :class="{ 'has-notification': unreadMail > 0 }"
        :aria-label="unreadMail ? `Open local inbox, ${unreadMail} unread` : 'Open local inbox'"
        title="Open local inbox"
        :aria-disabled="busy || undefined"
        @click="emit('list', 'mail')"
      >
        <Mail v-if="unreadMail" aria-hidden="true" />
        <MailOpen v-else aria-hidden="true" />
        <span v-if="unreadMail" class="notification-count" aria-hidden="true">{{
          unreadMail
        }}</span>
      </button>
    </div>
    <p class="milestone-announcement" role="status" dir="auto">{{ statusAnnouncement }}</p>
  </div>
</template>

<style scoped>
.wordmark {
  font: 700 17px var(--mono);
  white-space: nowrap;
}
.terminal-scenario {
  min-width: 0;
  max-width: 28ch;
  color: var(--text);
  font: 600 14px/1.3 var(--sans);
}
h1.terminal-scenario {
  overflow: hidden;
  padding-inline-start: var(--space-2);
  border-inline-start: 1px solid var(--line);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.frame-title select {
  border-color: var(--line);
}
.frame-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 42px;
  padding-inline: var(--space-2);
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}
.frame-title button,
.frame-title select {
  min-height: var(--control-height);
}
.frame-title button {
  border-color: transparent;
  background: transparent;
}
.frame-title button:hover:not(:disabled) {
  background: var(--raised);
}
.title-actions {
  display: flex;
  flex: none;
  margin-inline-start: auto;
  color: var(--muted);
}
.frame-title .latest-progress,
.frame-title .has-notification,
.title-actions .status-reached,
.title-actions [aria-expanded='true'] {
  color: var(--accent);
}
.frame-title .latest-progress {
  background: #22382f;
}
.title-status,
.title-notification {
  position: relative;
}
.frame-title .title-status[aria-expanded='true'] {
  background: var(--raised);
  border-color: var(--control);
  border-block-end-color: var(--accent);
}
.check-meter {
  position: absolute;
  inset-inline: 8px;
  inset-block-end: 3px;
  block-size: 2px;
  background: var(--control);
}
.check-meter span {
  display: block;
  block-size: 100%;
  background: var(--accent);
}
.notification-count {
  position: absolute;
  inset-block-start: 2px;
  inset-inline-end: 1px;
  min-width: 13px;
  border-radius: 5px;
  padding-inline: 2px;
  background: var(--accent);
  color: var(--accent-ink);
  font: 700 10px/12px var(--sans);
  text-align: center;
}
.status-changing .status-mark {
  animation: title-status-change 1000ms ease-out;
}
@keyframes title-status-change {
  from {
    color: var(--accent);
    filter: drop-shadow(0 0 3px var(--accent));
  }
}
@media (prefers-reduced-motion: reduce) {
  .status-changing .status-mark {
    animation: none;
  }
}
@media (max-width: 700px) {
  .frame-title {
    gap: var(--space-1);
  }
}
@media (max-width: 600px), (pointer: coarse) {
  .frame-title button,
  .frame-title select {
    min-block-size: var(--touch-height);
  }
  .notification-count {
    inset-block-start: 6px;
    inset-inline-end: 4px;
  }
}
@media (max-width: 600px) {
  .wordmark {
    font-size: 15px;
  }
  .terminal-scenario {
    font-size: 13px;
  }
  select.terminal-scenario {
    padding-inline: 5px;
  }
}
@media (max-width: 360px) {
  .frame-title {
    padding-inline: var(--space-1);
  }
}
</style>
