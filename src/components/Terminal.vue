<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, reactive, ref, useId, watch } from 'vue'
import CommandComposer from './CommandComposer.vue'
import type { OperationBinding } from '../lib/scenario'
import TerminalFile from './TerminalFile.vue'
import TerminalInspection from './TerminalInspection.vue'
import TerminalMail from './TerminalMail.vue'
import TerminalProgress from './TerminalProgress.vue'
import { commandHelp } from '../lib/commands'
import { linkStatus, type Action, type Link, type Session } from '../lib/runtime'
import { inspectRange, notation, unpairedSurrogate } from '../lib/unicode'
import type { ComposerSave, Entry, TerminalView } from '../lib/workspace'

const props = defineProps<{
  transcript: Entry[]
  live: boolean
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
  initialComposer?: ComposerSave
  execute: (action: Action, echo?: string) => Promise<import('../lib/runtime').Response | undefined>
}>()
const emit = defineEmits<{ action: [Action, string?]; change: [] }>()
const sourceCoordinates = [
  ['utf8', 'UTF-8'],
  ['utf16', 'UTF-16'],
  ['scalars', 'Scalars'],
  ['graphemes', 'Graphemes'],
] as const
const outputPrefix = useId() + '-output-'
const scrollSpace = '--transcript-scroll-space'
const scroll = ref<HTMLDivElement>()
const frame = ref<HTMLElement>()
const composer = ref<InstanceType<typeof CommandComposer>>()
const following = ref(true)
const unseenProgress = ref(false)
const collapsedAnnouncement = ref('')
const selectedScalar = ref<string>()
const collapsed = reactive(new Set<number>())

function hexadecimal(value: number, width: number) {
  return value.toString(16).toUpperCase().padStart(width, '0')
}

function echoText(value: string) {
  if (value.length <= 512) return value
  const limit =
    /[\uD800-\uDBFF]/u.test(value[511]) && /[\uDC00-\uDFFF]/u.test(value[512]) ? 511 : 512
  return value.slice(0, limit) + '…'
}

async function toggleOutput(id: number) {
  const box = scroll.value
  const top = box?.scrollTop ?? 0
  if (collapsed.has(id)) collapsed.delete(id)
  else collapsed.add(id)
  await nextTick()
  if (box && box === scroll.value) {
    const last = box.lastElementChild
    if (last && top > 0) {
      // The last entry gives the natural end even when the content fits inside the viewport.
      const contentEnd =
        last.getBoundingClientRect().bottom -
        box.getBoundingClientRect().top +
        box.scrollTop +
        Number.parseFloat(getComputedStyle(box).paddingBottom)
      const space = Math.ceil(top + box.clientHeight - contentEnd)
      if (space > 0) box.style.setProperty(scrollSpace, `${space}px`)
      else box.style.removeProperty(scrollSpace)
    }
    box.scrollTop = top
  }
  trackScroll()
  readResourceSelection()
}

function scrollToEnd() {
  const box = scroll.value
  if (box) {
    box.style.removeProperty(scrollSpace)
    box.scrollTop = box.scrollHeight
  }
  following.value = true
  unseenProgress.value = false
}

function atOpening() {
  return (
    props.transcript.length === 1 && props.transcript[0].id === 0 && scroll.value?.scrollTop === 0
  )
}

function trackScroll() {
  const box = scroll.value
  if (box) {
    const space = Number.parseFloat(box.style.getPropertyValue(scrollSpace))
    const distance = box.scrollHeight - box.scrollTop - box.clientHeight
    if (space && (box.scrollTop === 0 || distance >= space)) box.style.removeProperty(scrollSpace)
    following.value = box.scrollHeight - box.scrollTop - box.clientHeight < (atOpening() ? 1 : 28)
  }
  if (following.value) unseenProgress.value = false
  emit('change')
}

function saveView(): TerminalView {
  return {
    collapsed: [...collapsed],
    scrollTop: scroll.value?.scrollTop ?? 0,
    following: following.value,
  }
}

function restoreView(view?: TerminalView) {
  collapsed.clear()
  if (Array.isArray(view?.collapsed))
    for (const id of view.collapsed)
      if (props.transcript.some((entry) => entry.id === id)) collapsed.add(id)
  following.value = view?.following !== false
  void nextTick(() => {
    if (!scroll.value) return
    scroll.value.style.removeProperty(scrollSpace)
    const opening =
      !view?.scrollTop && props.transcript.length === 1 && props.transcript[0].id === 0
    if (opening || (view?.following === false && Number.isFinite(view.scrollTop))) {
      scroll.value.scrollTop = view?.scrollTop ?? 0
      trackScroll()
    } else scrollToEnd()
  })
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
  if (atOpening()) {
    requestAnimationFrame(() => {
      if (atOpening()) trackScroll()
    })
  } else if (following.value) scrollToEnd()
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
  (entries, previous) => {
    for (const id of collapsed) {
      if (!entries.some((entry) => entry.id === id)) collapsed.delete(id)
    }
    const last = entries.at(-1)
    const prior = previous.at(-1)
    const progress = last?.freshProgress
      ? last.output
          .slice(last.id === prior?.id ? prior.output.length : 0)
          .flatMap((row) => ('progress' in row && row.progress ? [row.progress] : []))
      : []
    if (last && progress.length && collapsed.has(last.id)) {
      collapsedAnnouncement.value = progress.map(({ title, text }) => title + '. ' + text).join(' ')
    } else if (last?.id !== prior?.id) {
      collapsedAnnouncement.value = ''
    }
    const firstCommand = prior?.id === 0 && last && last.id !== 0 && scroll.value?.scrollTop === 0
    if (following.value || firstCommand) scrollToEnd()
    else if (progress.length) unseenProgress.value = true
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
    if (entry.freshProgress && entry.output.some((row) => 'progress' in row && row.progress))
      unseenProgress.value = true
  } else {
    scrollToEnd()
  }
  if (focus) {
    frame.value?.scrollIntoView({ block: 'nearest' })
    latest.focus({ preventScroll: true })
  }
}

async function openTitleList(type: 'hosts' | 'mail') {
  const response = await props.execute({ type, scope: 'local' })
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
  saveView,
  restoreView,
  saveComposer: (submitted: boolean) => composer.value?.saveComposer(submitted),
  resetComposer: () => composer.value?.resetComposer(),
})
</script>

<template>
  <section ref="frame" class="terminal-frame" aria-label="Terminal">
    <div class="frame-title">
      <span class="wordmark">unicodd</span>
      <slot name="scenario" />
      <slot name="session-status" />
      <div class="title-actions">
        <button
          type="button"
          class="title-notification"
          :class="{ 'has-notification': newHosts > 0 }"
          :aria-label="newHosts ? `Open local hosts, ${newHosts} new` : 'Open local hosts'"
          title="Open local hosts"
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
          :aria-label="unreadMail ? `Open local inbox, ${unreadMail} unread` : 'Open local inbox'"
          title="Open local inbox"
          :aria-disabled="busy || undefined"
          @click="openTitleList('mail')"
        >
          <span class="title-icon mail-icon" aria-hidden="true"></span>
          <span v-if="unreadMail" class="notification-count" aria-hidden="true">{{
            unreadMail
          }}</span>
        </button>
        <button
          v-if="!following"
          type="button"
          class="latest-output"
          :class="{ 'latest-progress': unseenProgress }"
          :aria-label="unseenProgress ? 'Latest output, new milestone' : 'Latest output'"
          @click="scrollToEnd"
        >
          <span class="latest-output-label"
            >Latest<span class="latest-output-word"> output</span></span
          >
          ↓
        </button>
      </div>
    </div>
    <div class="terminal-session"><slot name="session-details" /></div>
    <p class="milestone-announcement" role="status" dir="auto">{{ collapsedAnnouncement }}</p>
    <div
      ref="scroll"
      class="transcript"
      role="log"
      :aria-live="live ? 'polite' : 'off'"
      aria-relevant="additions"
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
          @click="toggleOutput(entry.id)"
        >
          <p class="command-line">
            <span class="prompt-host" :class="{ remote: entry.connected }"
              >{{ entry.connected ? '@' : '' }}{{ entry.prompt }} ›</span
            >
            <bdi>{{
              echoText(entry.localScope ? entry.echo.replace(/^\s*local\s+/u, '') : entry.echo)
            }}</bdi>
          </p>
          <div class="entry-actions">
            <button
              type="button"
              aria-label="Reuse command"
              title="Copy into command input"
              :disabled="!composer?.canReuse"
              @click.stop="composer?.reuseCommand(entry.echo)"
            >
              Reuse
            </button>
            <button
              v-if="entry.output.length || entry.waiting"
              type="button"
              class="output-toggle"
              :class="{
                'collapsed-progress':
                  collapsed.has(entry.id) &&
                  entry.output.some((row) => 'progress' in row && row.progress),
              }"
              aria-label="Toggle command output"
              :aria-controls="outputPrefix + entry.id"
              :aria-expanded="!collapsed.has(entry.id)"
              :title="collapsed.has(entry.id) ? 'Show output' : 'Hide output'"
              @click.stop="toggleOutput(entry.id)"
            >
              <span aria-hidden="true">{{ collapsed.has(entry.id) ? '◂' : '▾' }}</span>
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
                      :disabled="
                        link.action.type === 'connect' && connected && link.action.host === prompt
                      "
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
                :format="row.format"
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
                aria-label="New mail, open local inbox"
                :aria-disabled="busy || undefined"
                @click="openTitleList('mail')"
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
                  <span v-if="record.hex" class="report-hex" dir="ltr">
                    <span v-if="record.hex.chunkStart" class="report-chunk">chunk</span>
                    <button
                      v-for="(byte, index) in record.hex.bytes"
                      :key="index"
                      type="button"
                      class="terminal-link"
                      :class="{
                        'report-invalid-byte':
                          record.hex.highlight &&
                          record.hex.offset + index >= record.hex.highlight[0] &&
                          record.hex.offset + index < record.hex.highlight[1],
                      }"
                      :aria-label="
                        'Use offset 0x' +
                        hexadecimal(record.hex.offset + index, 4) +
                        ' for byte ' +
                        hexadecimal(byte, 2)
                      "
                      :aria-disabled="busy || !composer?.canInsert || undefined"
                      @click="
                        !busy &&
                        composer?.canInsert &&
                        emit('action', {
                          type: 'editPayload',
                          mode: composer.canReplace ? 'replace' : 'insert',
                          text: '0x' + hexadecimal(record.hex.offset + index, 4),
                        })
                      "
                    >
                      {{ hexadecimal(byte, 2) }}
                    </button>
                  </span>
                  <span v-else-if="record.fields.length" class="report-fields" data-resource-text>
                    <bdi v-for="(field, index) in record.fields" :key="index">{{ field }}</bdi>
                  </span>
                  <template v-if="record.source">
                    <bdi class="report-source" data-resource-text
                      >{{ record.source.before }}<mark>{{ record.source.hit }}</mark
                      >{{ record.source.after }}</bdi
                    >
                    <span class="report-details" dir="ltr">
                      <template v-for="[space, label] in sourceCoordinates" :key="space">
                        <button
                          v-if="composer?.canInsert"
                          type="button"
                          class="terminal-link"
                          :aria-label="
                            'Use ' + label + ' range ' + record.source.coordinates[space].join('-')
                          "
                          :aria-disabled="busy || undefined"
                          @click="
                            !busy &&
                            emit('action', {
                              type: 'editPayload',
                              mode: composer.canReplace ? 'replace' : 'insert',
                              text: record.source.coordinates[space].join('-'),
                            })
                          "
                        >
                          {{ label }} {{ record.source.coordinates[space].join('–') }}
                        </button>
                        <span v-else
                          >{{ label }} {{ record.source.coordinates[space].join('–') }}</span
                        >
                        <span
                          v-if="space === 'graphemes' && !record.source.coordinates.exactGraphemes"
                          >(covering)</span
                        >
                      </template>
                    </span>
                  </template>
                  <button
                    v-if="record.serialized !== undefined"
                    type="button"
                    class="terminal-link"
                    :aria-disabled="busy || undefined"
                    @click="emit('action', { type: 'copy', text: record.serialized })"
                  >
                    {{ record.copyLabel ?? (record.audit ? 'Copy line' : 'Copy cursor') }}
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
                      ? 'File paths start at this host’s root. The title bar opens local mail and hosts without disconnecting.'
                      : 'This console opens remote sessions and holds your inbox and campaign.'
                  }}
                </p>
              </div>
              <TerminalProgress
                v-else-if="(row.kind === 'milestone' || row.kind === 'objective') && row.progress"
                :progress="row.progress"
                :fresh="Boolean(entry.freshProgress)"
              />
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
          :key="link.action.type"
          type="button"
          :data-action="link.action.type"
          :title="link.label"
          :disabled="busy"
          @click="
            link.action.type === 'commit'
              ? composer?.selectCommand('commit')
              : emit('action', link.action)
          "
        >
          {{ connected && 'scope' in link.action && link.action.scope === 'local' ? 'local ' : ''
          }}{{ link.action.type }}
        </button>
        <button
          v-if="selectedScalar !== undefined"
          type="button"
          title="Inspect selected character"
          :disabled="busy"
          @mousedown.prevent
          @click="emit('action', { type: 'inspect', character: selectedScalar })"
        >
          inspect {{ notation(selectedScalar.codePointAt(0)!) }}
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
        :initial="initialComposer"
        :execute="execute"
        @action="emit('action', $event)"
        @change="emit('change')"
      />
    </div>
  </section>
</template>
