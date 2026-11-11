<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, reactive, ref, useId, watch } from 'vue'
import CommandComposer from './CommandComposer.vue'
import type { OperationBinding } from '../lib/scenario'
import TerminalFile from './TerminalFile.vue'
import TerminalInspection from './TerminalInspection.vue'
import TerminalMail from './TerminalMail.vue'
import { commandHelp } from '../lib/commands'
import { linkStatus, type Action, type Link, type Output, type Session } from '../lib/runtime'
import { inspectRange, unpairedSurrogate } from '../lib/unicode'

export interface Entry {
  id: number
  echo?: string
  prompt?: string
  connected?: boolean
  output: Output[]
  waiting?: boolean
}

const props = defineProps<{
  transcript: Entry[]
  prompt: string
  connected: boolean
  shortcuts: Link[]
  suggestions: string[]
  busy: boolean
  context: string
  operations: readonly OperationBinding[]
  activity: Pick<Session, 'visitedHosts' | 'readMail' | 'readResources'>
  newHosts: number
  unreadMail?: number
  execute: (action: Action, echo?: string) => Promise<import('../lib/runtime').Response | undefined>
}>()
const emit = defineEmits<{ action: [Action, string?] }>()
const outputPrefix = useId() + '-output-'
const scroll = ref<HTMLDivElement>()
const frame = ref<HTMLElement>()
const composer = ref<InstanceType<typeof CommandComposer>>()
const following = ref(true)
const selectedScalar = ref<string>()
const collapsed = reactive(new Set<number>())

function echoText(value: string) {
  if (value.length <= 512) return value
  const limit =
    /[\uD800-\uDBFF]/u.test(value[511]) && /[\uDC00-\uDFFF]/u.test(value[512]) ? 511 : 512
  return value.slice(0, limit) + '…'
}

async function toggleOutput(id: number) {
  if (collapsed.has(id)) collapsed.delete(id)
  else collapsed.add(id)
  await nextTick()
  trackScroll()
  readResourceSelection()
}

function scrollToEnd() {
  if (scroll.value) scroll.value.scrollTop = scroll.value.scrollHeight
  following.value = true
}

function trackScroll() {
  const box = scroll.value
  if (box) following.value = box.scrollHeight - box.scrollTop - box.clientHeight < 28
}

function readResourceSelection() {
  const selection = window.getSelection()
  const node = (node: Node | null | undefined) =>
    node instanceof Element ? node : node?.parentElement
  const start = node(selection?.anchorNode)?.closest('[data-resource-text]')
  const end = node(selection?.focusNode)?.closest('[data-resource-text]')
  const text = selection?.toString() ?? ''
  selectedScalar.value =
    start &&
    start === end &&
    scroll.value?.contains(start) &&
    start.getClientRects().length &&
    Array.from(text).length === 1 &&
    unpairedSurrogate(text) === undefined
      ? text
      : undefined
}

const transcriptResize = new ResizeObserver(() => {
  if (following.value) scrollToEnd()
})
onMounted(() => {
  document.addEventListener('selectionchange', readResourceSelection)
  if (scroll.value) transcriptResize.observe(scroll.value)
})
onUnmounted(() => {
  document.removeEventListener('selectionchange', readResourceSelection)
  transcriptResize.disconnect()
})

watch(
  () => props.transcript,
  (entries) => {
    for (const id of collapsed) {
      if (!entries.some((entry) => entry.id === id)) collapsed.delete(id)
    }
    if (following.value) scrollToEnd()
  },
  { flush: 'post' },
)

function revealOutput(
  kind: 'inspection' | 'mail' | 'file' | 'report' | 'list',
  focus: boolean,
  followOnly = false,
) {
  if (followOnly && !following.value) return
  const entry = props.transcript.at(-1)
  if (!entry || collapsed.has(entry.id)) return
  const box = scroll.value
  const selector = kind === 'inspection' ? '.inspection' : '.terminal-' + kind
  const latest = box?.lastElementChild?.querySelector<HTMLElement>(selector)
  if (!box || !latest) return
  if (latest.offsetHeight + 12 > box.clientHeight) {
    box.scrollTop += latest.getBoundingClientRect().top - box.getBoundingClientRect().top - 6
    trackScroll()
  } else {
    scrollToEnd()
  }
  if (focus) {
    frame.value?.scrollIntoView({ block: 'nearest' })
    latest.focus({ preventScroll: true })
  }
}

async function openTitleList(type: 'hosts' | 'mail') {
  const response = await props.execute({ type })
  if (response?.output?.[0]?.kind === 'listing') {
    await nextTick()
    revealOutput('list', true)
  }
}

function focusTranscript() {
  scroll.value?.focus({ preventScroll: true })
}

defineExpose({
  focusTranscript,
  insertCommand: (text: string) => composer.value?.insertCommand(text),
  applyText: (mode: 'insert' | 'replace', text: string) => composer.value?.applyText(mode, text),
  selectCommand: (name: import('../lib/commands').CommandName) =>
    composer.value?.selectCommand(name),
  revealOutput,
  scrollToEnd,
})
</script>

<template>
  <section ref="frame" class="terminal-frame" aria-label="Terminal">
    <div class="frame-title">
      <span class="wordmark">unicodd</span>
      <slot name="scenario" />
      <div class="title-actions">
        <button
          type="button"
          class="title-notification"
          :class="{ 'has-notification': newHosts > 0 }"
          :aria-label="newHosts ? `Open hosts list, ${newHosts} new` : 'Open hosts list'"
          title="Open hosts list"
          :aria-disabled="busy || undefined"
          @click="openTitleList('hosts')"
        >
          <span class="title-icon hosts-icon" aria-hidden="true"></span>
          <span v-if="newHosts" class="notification-count" aria-hidden="true">{{ newHosts }}</span>
        </button>
        <button
          v-if="unreadMail !== undefined"
          type="button"
          class="title-notification"
          :class="{ 'has-notification': unreadMail > 0 }"
          :aria-label="unreadMail ? `Open inbox, ${unreadMail} unread` : 'Open inbox'"
          title="Open inbox"
          :aria-disabled="busy || undefined"
          @click="openTitleList('mail')"
        >
          <span class="title-icon mail-icon" aria-hidden="true"></span>
          <span v-if="unreadMail" class="notification-count" aria-hidden="true">{{
            unreadMail
          }}</span>
        </button>
        <slot name="title-actions" />
        <button v-if="!following" type="button" aria-label="Latest output" @click="scrollToEnd">
          <span class="latest-output-label"
            >Latest<span class="latest-output-word"> output</span></span
          >
          ↓
        </button>
      </div>
    </div>
    <div id="terminal-context" />
    <div
      ref="scroll"
      class="transcript"
      role="log"
      aria-label="Terminal transcript"
      tabindex="0"
      @scroll="trackScroll"
    >
      <article
        v-for="entry in transcript"
        :key="entry.id"
        class="terminal-entry"
        :class="{ 'has-command': entry.echo !== undefined, 'remote-entry': entry.connected }"
      >
        <div
          v-if="entry.echo !== undefined"
          class="command-echo"
          :class="{ remote: entry.connected }"
        >
          <p class="command-line">
            <span class="prompt-host" :class="{ remote: entry.connected }"
              >{{ entry.connected ? '@' : '' }}{{ entry.prompt }} ›</span
            >
            <bdi>{{ echoText(entry.echo) }}</bdi>
          </p>
          <div class="entry-actions">
            <button
              type="button"
              aria-label="Reuse command"
              title="Copy into command input"
              :disabled="!composer?.canReuse"
              @click="composer?.reuseCommand(entry.echo)"
            >
              Reuse
            </button>
            <button
              v-if="entry.output.length || entry.waiting"
              type="button"
              class="output-toggle"
              aria-label="Toggle command output"
              :aria-controls="outputPrefix + entry.id"
              :aria-expanded="!collapsed.has(entry.id)"
              :title="collapsed.has(entry.id) ? 'Show output' : 'Hide output'"
              @click="toggleOutput(entry.id)"
            >
              <span aria-hidden="true">{{ collapsed.has(entry.id) ? '▸' : '▾' }}</span>
            </button>
          </div>
        </div>
        <div
          v-if="entry.output.length || entry.waiting"
          v-show="!collapsed.has(entry.id)"
          :id="outputPrefix + entry.id"
          class="entry-body"
        >
          <div v-if="entry.output.length" class="entry-output">
            <template v-for="(row, index) in entry.output" :key="index">
              <div v-if="row.kind === 'listing'" class="terminal-list" tabindex="-1">
                <p class="listing-path">
                  <bdi>{{ row.path ?? row.title ?? 'Known hosts' }}</bdi>
                </p>
                <p v-if="!row.links.length" class="meta">{{ row.empty ?? 'Empty directory.' }}</p>
                <ul v-else>
                  <li
                    v-for="(link, index) in row.links"
                    :key="index"
                    :data-status="linkStatus(link, activity)"
                  >
                    <button
                      type="button"
                      class="terminal-link"
                      :aria-disabled="busy || undefined"
                      @click="emit('action', link.action)"
                    >
                      <bdi>{{ link.label }}</bdi>
                    </button>
                    <span v-if="link.detail || link.tracking" class="listing-detail">
                      <bdi v-if="link.detail">{{ link.detail }}</bdi>
                      <template v-if="linkStatus(link, activity)">
                        {{ link.detail ? ' · ' : '' }}
                        <span class="listing-status">{{ linkStatus(link, activity) }}</span>
                      </template>
                    </span>
                  </li>
                </ul>
              </div>
              <TerminalFile
                v-else-if="row.kind === 'file'"
                :path="row.path"
                :text="row.text"
                :inspect-lines="row.inspectLines"
                :inspect-notation="row.inspectNotation"
                :busy="busy"
                @action="emit('action', $event)"
              />
              <TerminalMail
                v-else-if="row.kind === 'mail'"
                :path="row.path"
                :messages="row.messages"
              />
              <button
                v-else-if="row.kind === 'mailNotice'"
                type="button"
                class="terminal-link mail-notice"
                aria-label="New mail, open inbox"
                :aria-disabled="busy || undefined"
                @click="emit('action', { type: 'mail' })"
              >
                NEW MAIL
              </button>
              <TerminalInspection
                v-else-if="row.kind === 'inspection'"
                :row="row"
                :can-insert-payload="Boolean(composer?.canInsert)"
                :can-insert-command="Boolean(composer?.canInsertCommand)"
                :can-replace="Boolean(composer?.canReplace)"
                :busy="busy"
                @action="emit('action', $event)"
              />
              <div v-else-if="row.kind === 'report'" class="terminal-report" tabindex="-1">
                <div
                  v-for="(record, number) in row.rows"
                  :key="number"
                  class="report-row"
                  :class="{ 'audit-row': record.audit }"
                >
                  <strong
                    ><bdi>{{ record.label }}</bdi></strong
                  >
                  <span v-if="record.details" class="report-details">
                    <bdi v-for="(detail, index) in record.details" :key="index">{{ detail }}</bdi>
                  </span>
                  <span class="report-fields" data-resource-text>
                    <bdi v-for="(field, index) in record.fields" :key="index">{{ field }}</bdi>
                  </span>
                  <button
                    v-if="record.serialized !== undefined"
                    type="button"
                    class="terminal-link"
                    :aria-disabled="busy || undefined"
                    @click="emit('action', { type: 'copy', text: record.serialized })"
                  >
                    Copy {{ record.audit ? 'line' : 'cursor' }}
                  </button>
                  <span v-if="record.inspect" class="report-points">
                    <template v-for="(field, index) in record.inspect" :key="index">
                      <button
                        v-for="point in inspectRange(field, 0, 24)"
                        :key="point.start"
                        type="button"
                        class="terminal-link"
                        :aria-disabled="busy || undefined"
                        @click="emit('action', { type: 'inspect', character: point.scalar })"
                      >
                        {{ point.notation }}
                      </button>
                    </template>
                  </span>
                </div>
              </div>
              <div v-else-if="row.kind === 'help'" class="command-help">
                <dl>
                  <template
                    v-for="[usage, detail] in commandHelp.filter(([usage]) =>
                      row.commands.includes(usage.split(' ')[0]),
                    )"
                    :key="usage"
                  >
                    <dt>{{ usage }}</dt>
                    <dd>{{ detail }}</dd>
                  </template>
                </dl>
                <p>
                  {{
                    row.connected
                      ? 'File paths start at the host root.'
                      : 'Choose a host to begin exploring.'
                  }}
                </p>
              </div>
              <p v-else :class="['terminal-line', row.kind]" dir="auto">{{ row.text }}</p>
            </template>
          </div>
          <p
            v-if="entry.waiting"
            class="output-wait meta"
            role="status"
            aria-label="Waiting for output"
          >
            …
          </p>
        </div>
      </article>
    </div>
    <div class="terminal-controls">
      <div class="toolbar shortcuts" aria-label="Quick actions" role="group">
        <button
          v-for="link in shortcuts"
          :key="link.label"
          type="button"
          :data-action="link.action.type"
          :disabled="busy"
          @click="emit('action', link.action)"
        >
          {{ link.label }}
        </button>
        <button
          v-if="selectedScalar !== undefined"
          type="button"
          :disabled="busy"
          @mousedown.prevent
          @click="emit('action', { type: 'inspect', character: selectedScalar })"
        >
          Inspect selection
        </button>
      </div>
      <CommandComposer
        ref="composer"
        :prompt="prompt"
        :connected="connected"
        :suggestions="suggestions"
        :operations="operations"
        :context="context"
        :busy="busy"
        :execute="execute"
        @action="emit('action', $event)"
      />
    </div>
  </section>
</template>
