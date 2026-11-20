<script setup lang="ts">
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  CircleDashed,
  Flag,
  ListChecks,
  Mail,
  Monitor,
  RotateCcw,
  Server,
  Target,
  Terminal as TerminalIcon,
} from '@lucide/vue'
import { computed, ref, shallowRef, watch, type Component } from 'vue'
import type { ScenarioEntry } from '../lib/content'
import type { createRuntime, Session } from '../lib/runtime'

const props = defineProps<{
  scenarioId: string
  scenarioTitle: string
  objective: string
  destinations: ScenarioEntry[]
  debugSelector?: { label: string; optionSuffix: string }
  session: Session
  hostStatus?: ReturnType<typeof createRuntime>['hostStatus']
  permissionLabel: string
  goalStatus: string
  caseComplete: boolean
  campaignFinished: boolean
  transcriptLive: boolean
  sessionExpanded: boolean
  sessionSection: string
  busy: boolean
  newHosts: number
  unreadMail?: number
  following: boolean
  unseenProgress: boolean
}>()
const emit = defineEmits<{
  scenario: [string]
  session: [string]
  list: ['hosts' | 'mail']
  latest: [MouseEvent]
}>()

interface StatusControl {
  key: string
  name: string
  label?: string
  detail: string
  icon: Component
  reached: boolean
}
const hostChecks = computed<StatusControl[]>(() =>
  (props.hostStatus ?? []).flatMap(({ label, value, reached }, index) =>
    reached === undefined
      ? []
      : [
          {
            key: 'host-' + index,
            name: `Host: ${label}: ${value}`,
            label,
            detail: `${label}: ${value}`,
            icon: reached ? Check : CircleDashed,
            reached,
          },
        ],
  ),
)
const titleStatus = computed<StatusControl[]>(() => {
  const active = props.session
  const role = props.permissionLabel
  const location = active.host ? '@' + active.host.id : 'Local console'
  return [
    {
      key: 'session',
      name: `Session: ${location} ${role}`,
      detail: `${active.host ? 'Connected to ' + active.host.id : 'Local console'}. Signed in as ${active.identity.user}. Permissions: ${role}.`,
      icon: active.host ? TerminalIcon : Monitor,
      reached: Boolean(active.host && active.identity.role !== active.host.guest.role),
    },
    {
      key: 'goal',
      name: 'Goal: ' + props.goalStatus,
      detail: 'Goal: ' + props.goalStatus,
      icon: active.completed ? Check : props.caseComplete ? RotateCcw : Target,
      reached: props.caseComplete,
    },
    ...hostChecks.value,
  ]
})
const hostCheckCount = computed(
  () => `${hostChecks.value.filter(({ reached }) => reached).length}/${hostChecks.value.length}`,
)
const hostCheckDetails = computed(() => hostChecks.value.map(({ detail }) => detail).join('\n'))
const changedStatus = shallowRef(new Set<string>())
const statusAnnouncement = ref('')
watch(
  [titleStatus, () => props.campaignFinished],
  ([current, finished], [previous, wasFinished]) => {
    if (!props.transcriptLive) {
      changedStatus.value = new Set()
      statusAnnouncement.value = ''
      return
    }
    const changed = current.filter(
      (item) => previous.find(({ key }) => key === item.key)?.detail !== item.detail,
    )
    const campaignCompleted = finished && !wasFinished
    if (changed.length || campaignCompleted) {
      changedStatus.value = new Set([
        ...changed.map(({ key }) => key),
        ...(campaignCompleted ? ['campaign'] : []),
      ])
      statusAnnouncement.value = [
        ...changed.map(({ detail }) => detail),
        ...(campaignCompleted ? ['All available scenarios complete'] : []),
      ].join(' ')
    }
  },
)
</script>

<template>
  <div class="frame-title">
    <span class="wordmark">unicodd</span>
    <h1 v-if="destinations.length === 1 && !debugSelector" class="terminal-scenario">
      <button
        type="button"
        aria-controls="session-details"
        :aria-expanded="sessionExpanded"
        @click="emit('session', 'session')"
      >
        <bdi>{{ scenarioTitle }}</bdi>
      </button>
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
    <div
      class="session-context-bar"
      :class="{ 'grouped-host-status': hostChecks.length > 1 }"
      role="group"
      aria-label="Session status"
    >
      <button
        v-for="item in titleStatus"
        :key="item.key"
        type="button"
        :class="{
          'session-location': item.key === 'session',
          'host-status-item': item.key.startsWith('host-'),
          'goal-status': item.key === 'goal',
          'status-reached': item.reached,
          'status-changing': changedStatus.has(item.key),
          'status-selected': sessionExpanded && sessionSection === item.key,
        }"
        :aria-label="item.name"
        :aria-description="item.key === 'goal' ? objective : undefined"
        :title="item.key === 'goal' ? `${item.detail}\n${objective}` : item.detail"
        aria-controls="session-details"
        :aria-expanded="sessionExpanded"
        @click="emit('session', item.key)"
      >
        <component :is="item.icon" :key="item.detail" class="status-mark" aria-hidden="true" />
        <span v-if="item.key === 'session'" class="context-label">
          <bdi>{{ session.host ? '@' + session.host.id : 'Local console' }}</bdi
          >{{ ' ' }}
          <bdi class="context-value">{{ permissionLabel }}</bdi>
        </span>
        <span v-else-if="item.key === 'goal'" class="context-label">
          <span class="goal-label">Goal</span>{{ ' ' }}
          <span v-if="caseComplete" class="context-value">{{ goalStatus }}</span>
          <template v-else>
            <span class="goal-stage context-value">{{ goalStatus }}</span>
            <bdi class="goal-preview" dir="auto">{{ objective }}</bdi>
          </template>
        </span>
        <bdi v-else-if="item.label" class="check-label">{{ item.label }}</bdi>
        <span v-if="item.label" class="check-short-label">Host</span>
        <ChevronDown
          v-if="item.key === 'session' || item.key === 'goal'"
          class="disclosure-icon"
          aria-hidden="true"
        />
      </button>
      <button
        v-if="hostChecks.length > 1"
        type="button"
        class="host-status-summary"
        :class="{
          'status-selected': sessionExpanded && sessionSection.startsWith('host-'),
          'status-changing': hostChecks.some(({ key }) => changedStatus.has(key)),
        }"
        aria-label="Host status"
        :title="hostCheckDetails"
        aria-controls="session-details"
        :aria-expanded="sessionExpanded"
        @click="emit('session', 'host-summary')"
      >
        <ListChecks :key="hostCheckDetails" class="status-mark" aria-hidden="true" />
        <span class="status-count" aria-hidden="true">{{ hostCheckCount }}</span>
      </button>
    </div>
    <p class="milestone-announcement" role="status" dir="auto">{{ statusAnnouncement }}</p>
    <div class="title-actions">
      <button
        v-if="campaignFinished"
        type="button"
        class="icon-button campaign-status"
        :class="{
          'status-changing': changedStatus.has('campaign'),
          'status-selected': sessionExpanded && sessionSection === 'campaign',
        }"
        aria-label="All available scenarios complete"
        title="All available scenarios complete"
        aria-controls="session-details"
        :aria-expanded="sessionExpanded"
        @click="emit('session', 'campaign')"
      >
        <Flag class="status-mark" aria-hidden="true" />
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
        <Mail aria-hidden="true" />
        <span v-if="unreadMail" class="notification-count" aria-hidden="true">{{
          unreadMail
        }}</span>
      </button>
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
    </div>
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
  border-inline-start: 1px solid var(--line);
}
.frame-title h1.terminal-scenario button {
  display: block;
  max-width: 100%;
  overflow: hidden;
  color: inherit;
  font: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.frame-title h1.terminal-scenario button[aria-expanded='true'] {
  color: var(--accent);
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
.frame-title .campaign-status,
.frame-title .has-notification {
  color: var(--accent);
}
.frame-title .latest-progress {
  background: #22382f;
}
.title-notification {
  position: relative;
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
  font: 700 10px/12px var(--mono);
  text-align: center;
}
.session-context-bar {
  display: flex;
  align-items: center;
  min-width: 0;
  padding-inline-start: var(--space-1);
  border-inline-start: 1px solid var(--line);
}
.frame-title .session-context-bar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-width: var(--control-height);
  padding: 3px 6px;
  font: 600 12px/1.25 var(--sans);
}
.frame-title .session-context-bar .session-location {
  min-width: 0;
  flex: 0 1 auto;
}
.context-label {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  text-align: start;
}
.context-label bdi,
.check-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.context-value,
.status-mark {
  color: var(--muted);
}
.status-reached .context-value,
.status-reached .status-mark,
.campaign-status .status-mark,
.host-status-summary.status-changing {
  color: var(--accent);
}
.frame-title button.status-selected {
  background: var(--raised);
  border-color: var(--control);
}
.status-selected .disclosure-icon {
  rotate: 180deg;
}
.frame-title .session-context-bar .host-status-summary,
.check-short-label {
  display: none;
}
.status-count {
  font-variant-numeric: tabular-nums;
}
.status-changing .status-mark {
  animation: session-status-change 1000ms ease-out;
}
@keyframes session-status-change {
  from {
    background: var(--accent);
    color: var(--accent-ink);
  }
}
@media (prefers-reduced-motion: reduce) {
  .status-changing .status-mark {
    animation: none;
  }
}
.context-label .goal-preview {
  display: none;
}

@media (max-width: 1080px) {
  .frame-title .grouped-host-status .host-status-item {
    display: none;
  }
  .frame-title .grouped-host-status .host-status-summary {
    display: inline-flex;
  }
}
@media (max-width: 700px) {
  .frame-title {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 0 var(--space-1);
  }
  .terminal-scenario {
    justify-self: start;
    max-width: 100%;
  }
  .title-actions {
    margin-inline-start: 0;
  }
  .session-context-bar {
    grid-column: 1 / -1;
    grid-row: 2;
    border-inline-start: 0;
    border-top: 1px solid var(--line);
    padding-inline-start: 0;
  }
  .context-label {
    display: grid;
    gap: 0;
  }
}
@media (max-width: 600px), (pointer: coarse) {
  .frame-title button,
  .frame-title select {
    min-block-size: var(--touch-height);
  }
  .frame-title .session-context-bar button {
    min-inline-size: var(--touch-height);
    min-height: 40px;
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
  .frame-title .session-location .status-mark {
    display: none;
  }
}
@media (max-width: 830px) {
  .frame-title .session-context-bar {
    flex: 1;
  }
  .frame-title .session-context-bar button {
    min-height: var(--compact-control);
    padding-block: var(--compact-tight);
    line-height: var(--compact-leading);
  }
  .frame-title .session-context-bar .session-location {
    flex: 0 0 auto;
  }
  .session-location .context-label {
    display: grid;
    gap: 0;
  }
  .frame-title .session-location .context-value {
    font-size: var(--compact-meta);
  }
  .frame-title .goal-status {
    min-width: 0;
  }
  .goal-status:has(.goal-preview) :is(.goal-label, .goal-stage) {
    display: none;
  }
  .context-label .goal-preview {
    display: -webkit-box;
    max-inline-size: 34ch;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .goal-status:has(.goal-preview) .status-mark {
    display: none;
  }
  .frame-title .host-status-item .check-label {
    display: none;
  }
  .frame-title .host-status-item .check-short-label {
    display: inline;
  }
}

@media (max-width: 700px) {
  .frame-title .session-context-bar .session-location {
    flex: 0 1 auto;
    max-width: 42%;
    justify-content: flex-start;
  }
  .frame-title .session-context-bar .goal-status {
    flex: 1;
    justify-content: flex-start;
    border-inline-start-color: var(--line);
  }
  .session-location .disclosure-icon {
    display: none;
  }
  .context-label .goal-preview {
    max-inline-size: none;
  }
}
</style>
