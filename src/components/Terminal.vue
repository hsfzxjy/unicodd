<script setup lang="ts">
import { ArrowDownToLine, ArrowUp, Flag } from '@lucide/vue'
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import CommandComposer from './CommandComposer.vue'
import TerminalEntry from './TerminalEntry.vue'
import TerminalReads from './TerminalReads.vue'
import TerminalReport from './TerminalReport.vue'
import TerminalResource from './TerminalResource.vue'
import type { TerminalEntryView } from '../composables/terminal-presentation'
import { sameResult, useTerminalTranscript } from '../composables/useTerminalTranscript'
import type { CommandName } from '../lib/commands'
import type { Action, Link, Output, Response, Session } from '../lib/runtime'
import type { OperationBinding } from '../lib/scenario'
import { notation } from '../lib/unicode'
import type { ComposerSave } from '../lib/workspace'

const props = defineProps<{
  transcript: TerminalEntryView[]
  openingRequest?: string
  live: boolean
  prompt: string
  connected: boolean
  shortViewport: boolean
  panelOpen: boolean
  shortcuts: Link[]
  suggestions: string[]
  busy: boolean
  context: string
  operations: readonly OperationBinding[]
  activity: Pick<Session, 'visitedHosts' | 'deliveredMail' | 'readMail' | 'readResources'>
  initialComposer?: ComposerSave
  execute: (action: Action, echo?: string) => Promise<Response | undefined>
}>()
const emit = defineEmits<{ action: [Action, string?]; change: []; dismissPanel: [] }>()
const outputPrefix = useId() + '-output-'
const scroll = ref<HTMLDivElement>()
const frame = ref<HTMLElement>()
const dock = ref<HTMLElement>()
const outcomeButton = ref<HTMLButtonElement>()
const composer = ref<InstanceType<typeof CommandComposer>>()
const readsControls = ref<InstanceType<typeof TerminalReads>>()
const compactLayout = window.matchMedia('(max-width: 830px)')
const compact = ref(compactLayout.matches)
const updateCompact = () => (compact.value = compactLayout.matches)
const opening = computed(() => {
  const [welcome, read] = props.transcript
  if (!props.openingRequest || welcome?.id !== 0 || read?.waiting || read?.prompt !== 'local')
    return
  const [letter] = read.output
  if (
    letter?.kind !== 'mail' ||
    letter.path !== undefined ||
    letter.messages.length !== 1 ||
    letter.messages[0].id !== props.openingRequest
  )
    return
  const directories = welcome.output.filter(
    (row): row is Extract<Output, { kind: 'listing' }> =>
      row.kind === 'listing' && row.links.some(({ action }) => action.type === 'connect'),
  )
  const [directory] = directories
  const [link] = directory?.links ?? []
  if (directories.length === 1 && directory.links.length === 1 && link.tracking?.kind === 'host')
    return { directory, read: read.id }
})
const {
  awayFromEnd,
  offscreenProgress,
  presentation,
  progressVisible,
  consumeProgress,
  collapsedAnnouncement,
  selectedScalar,
  collapsed,
  reads,
  reading,
  archived,
  result,
  resultReturn,
  openRead,
  back,
  backToRead,
  showResult,
  showProgress,
  latest,
  toggleOutput,
  trackScroll,
  saveView,
  restoreView,
  revealOutput,
  focusTranscript,
} = useTerminalTranscript({
  entries: () => props.transcript,
  scroll,
  frame,
  closeReads: () => readsControls.value?.close(),
  change: () => emit('change'),
})

const outcome = computed(() => (reading.value ? result.value : offscreenProgress.value))
watch([outcome, resultReturn], ([target, returning]) => {
  const cue = presentation.value
  if (cue?.target === 'jump' && (returning || !sameResult(target, cue.result)))
    consumeProgress(cue.result)
})
watch(presentation, async (cue, _, cleanup) => {
  if (cue?.target !== 'jump' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  let animation: Animation | undefined
  let canceled = false
  cleanup(() => {
    canceled = true
    animation?.cancel()
  })
  await nextTick()
  if (
    canceled ||
    !sameResult(outcome.value, cue.result) ||
    resultReturn.value ||
    !scroll.value?.contains(cue.anchor) ||
    progressVisible(cue.result, cue.anchor)
  )
    return
  animation = outcomeButton.value?.animate(
    [
      { boxShadow: 'inset 0 0 0 2px var(--evidence)' },
      { boxShadow: 'inset 0 0 0 2px transparent' },
    ],
    { duration: 180, easing: 'ease-out' },
  )
})
const viewLabel = computed(() => {
  switch (outcome.value?.kind) {
    case 'completion':
      return 'View completion'
    case 'milestone':
      return reading.value ? 'View result' : 'View milestone'
    case 'diagnostic':
      return 'View diagnostic'
    default:
      return 'View result'
  }
})

let layoutFrame = 0
function fitDetails() {
  const shell = frame.value
  const controls = dock.value
  if (!shell || !controls) return
  if (props.shortViewport) {
    const title = shell.querySelector<HTMLElement>('.frame-title')!
    const panel =
      props.panelOpen && compact.value ? shell.querySelector('.title-panel:not([hidden])') : null
    const editor = controls.querySelector<HTMLElement>('.command-composer')!
    const prompt = editor.querySelector<HTMLElement>('.prompt-line')!
    const inline = getComputedStyle(prompt).display === 'contents'
    const field = editor.querySelector<HTMLTextAreaElement>('.inline-argument textarea')
    const fixedPrompt = inline
      ? Math.max(
          Number.parseFloat(getComputedStyle(field!).minHeight),
          editor.querySelector<HTMLElement>('.run-command')!.offsetHeight,
        )
      : prompt.offsetHeight
    const floor = shell.clientHeight < 400 ? 72 : 100
    const available =
      shell.clientHeight -
      title.offsetHeight -
      (controls.offsetHeight - editor.offsetHeight + fixedPrompt) -
      floor
    const panelMinimum = panel ? (panel.id === 'session-details' ? 62 : 52) : 0
    const body = Math.max(0, available - panelMinimum)
    shell.style.setProperty('--transcript-floor', `${floor}px`)
    shell.style.setProperty('--composer-detail-budget', `${body}px`)
    shell.style.setProperty(
      '--title-detail-budget',
      `${Math.max(panelMinimum, available - (editor.offsetHeight - fixedPrompt))}px`,
    )
    if (field) {
      const fieldContext = editor.querySelector<HTMLElement>('.composer-fixed')?.offsetHeight ?? 0
      const inspectorHeader =
        editor.querySelector<HTMLElement>('.inspector-title')?.offsetHeight ?? 0
      const tools = editor.querySelector<HTMLElement>('.point-actions')?.offsetHeight ?? 0
      const firstGroup = editor.querySelector<HTMLElement>('.point')?.offsetHeight ?? 0
      const fieldInset = inline
        ? 0
        : Number.parseFloat(getComputedStyle(field.parentElement!).marginTop)
      const fixedDetails = fieldContext + inspectorHeader + tools + fieldInset
      const sharedRow = inline ? fixedPrompt : 0
      shell.style.setProperty(
        '--inline-editor-budget',
        `${Math.max(0, body + sharedRow - fixedDetails - (firstGroup ? firstGroup + 9 : 0))}px`,
      )
      shell.style.setProperty(
        '--inline-inspector-budget',
        `${Math.max(0, body - fixedDetails - (field.offsetHeight - sharedRow) - 1)}px`,
      )
    }
  }
  composer.value?.revealFocusedArgument()
}

function scheduleLayout() {
  cancelAnimationFrame(layoutFrame)
  layoutFrame = requestAnimationFrame(fitDetails)
}

const layoutObserver = new ResizeObserver(scheduleLayout)
watch(() => [props.shortViewport, props.panelOpen, compact.value], scheduleLayout)
onMounted(() => {
  compactLayout.addEventListener('change', updateCompact)
  if (frame.value) layoutObserver.observe(frame.value)
  if (dock.value) layoutObserver.observe(dock.value)
})
onUnmounted(() => {
  compactLayout.removeEventListener('change', updateCompact)
  layoutObserver.disconnect()
  cancelAnimationFrame(layoutFrame)
})

function revealFocusedTranscript(event: FocusEvent) {
  const target = event.target
  if (
    !props.panelOpen ||
    compact.value ||
    !(target instanceof HTMLElement) ||
    target === scroll.value ||
    !target.matches(':focus-visible')
  )
    return
  void nextTick(() => {
    if (document.activeElement !== target) return
    const panel = frame.value?.querySelector('.title-panel:not([hidden])')
    const overlay = panel?.getBoundingClientRect()
    const focus = target.getBoundingClientRect()
    if (
      overlay &&
      focus.left < overlay.right &&
      focus.right > overlay.left &&
      focus.top < overlay.bottom &&
      focus.bottom > overlay.top
    )
      emit('dismissPanel')
  })
}

async function openTitleList(type: 'hosts' | 'mail') {
  const response = await props.execute({ type, scope: 'local' })
  if (response?.output?.[0]?.kind === 'listing') {
    await nextTick()
    revealOutput('list', true)
  }
}

function keepEditing(event: MouseEvent) {
  if (document.activeElement?.matches('.command-composer input, .command-composer textarea'))
    event.preventDefault()
}

function viewOutcome(event: MouseEvent) {
  if (outcome.value) consumeProgress(outcome.value)
  const keyboard = event.detail === 0
  if (reading.value) void showResult(keyboard)
  else void showProgress(keyboard)
}

function selectCommand(name: CommandName) {
  return composer.value?.selectCommand(name)
}

defineExpose({
  focusTranscript,
  insertCommand: (text: string) => composer.value?.insertCommand(text),
  applyText: (mode: 'insert' | 'replace', text: string) => composer.value?.applyText(mode, text),
  selectCommand,
  revealOutput,
  saveView,
  restoreView,
  saveComposer: (submitted: boolean) => composer.value?.saveComposer(submitted),
  resetComposer: () => composer.value?.resetComposer(),
})
</script>

<template>
  <section ref="frame" class="terminal-frame" aria-label="Terminal">
    <slot name="title" v-bind="{ openTitleList }" />
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
      @focusin="revealFocusedTranscript"
    >
      <section
        v-if="archived"
        :key="archived.entry"
        :data-entry-id="archived.entry"
        class="earlier-read"
        aria-label="Earlier read"
        aria-live="off"
      >
        <p class="earlier-read-label transcript-label">
          Earlier read · <bdi>{{ archived.source }}</bdi>
        </p>
        <TerminalResource :output="archived.output" :busy="busy" @action="emit('action', $event)" />
        <TerminalReport
          v-if="archived.report"
          :rows="archived.report.rows"
          :busy="busy"
          :can-insert="Boolean(composer?.canInsert)"
          :can-replace="Boolean(composer?.canReplace)"
          @action="emit('action', $event)"
        />
      </section>
      <TerminalEntry
        v-for="entry in transcript"
        :key="entry.id"
        :entry="entry"
        :progress-cue="
          presentation?.target === 'band' && presentation.result.id === entry.id
            ? presentation.result.kind
            : undefined
        "
        :opening-directory="entry.id === opening?.read ? opening?.directory : undefined"
        :omit-row="entry.id === 0 ? opening?.directory : undefined"
        :output-id="outputPrefix + entry.id"
        :collapsed="collapsed.has(entry.id)"
        :activity="activity"
        :prompt="prompt"
        :connected="connected"
        :busy="busy"
        :can-reuse="Boolean(composer?.canReuse)"
        :can-insert="Boolean(composer?.canInsert)"
        :can-insert-command="Boolean(composer?.canInsertCommand)"
        :can-replace="Boolean(composer?.canReplace)"
        @action="emit('action', $event)"
        @compose="selectCommand"
        @toggle="toggleOutput(entry.id)"
        @mail="openTitleList('mail')"
        @reuse="composer?.reuseCommand($event)"
      />
    </div>
    <div ref="dock" class="terminal-controls">
      <div
        v-if="reading || outcome || awayFromEnd"
        class="transcript-navigation"
        role="group"
        aria-label="Transcript navigation"
        @mousedown="keepEditing"
      >
        <button v-if="resultReturn" type="button" @click="backToRead($event.detail === 0)">
          Back to read
        </button>
        <button v-if="reading" type="button" @click="back($event.detail === 0)">
          Back to work
        </button>
        <button
          v-if="outcome && !resultReturn"
          ref="outcomeButton"
          type="button"
          class="view-outcome"
          @click="viewOutcome"
        >
          <Flag
            v-if="outcome.kind === 'completion' || outcome.kind === 'milestone'"
            aria-hidden="true"
          />
          <ArrowUp v-else aria-hidden="true" />
          {{ viewLabel }}
        </button>
        <button
          v-if="awayFromEnd && (reading || !outcome)"
          type="button"
          class="latest-output"
          @click="latest($event.detail === 0)"
        >
          <ArrowDownToLine aria-hidden="true" /> Latest output
        </button>
      </div>
      <div class="toolbar shortcuts" aria-label="Quick actions" role="group">
        <TerminalReads
          ref="readsControls"
          :reads="reads"
          :trigger-target="compact ? composer?.promptTools : undefined"
          @open="openRead"
        >
          <button
            v-if="compact && connected && composer?.structured"
            type="button"
            title="Files"
            :disabled="busy"
            @click="emit('action', { type: 'ls' })"
          >
            ls
          </button>
        </TerminalReads>
        <button
          v-for="link in compact ? [] : shortcuts"
          :key="link.action.type"
          type="button"
          :data-action="link.action.type"
          :title="link.label"
          :disabled="busy"
          @click="
            link.action.type === 'commit' ? selectCommand('commit') : emit('action', link.action)
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

<style scoped>
.terminal-frame {
  inline-size: 100%;
  max-inline-size: var(--terminal-width);
  justify-self: center;
  min-width: 0;
  min-height: 0;
  border: var(--terminal-rule);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: max-content minmax(60px, 1fr) auto;
  background: var(--inset);
}
.short-viewport .terminal-frame {
  grid-template-rows: max-content minmax(var(--transcript-floor, 72px), 1fr) auto;
}
/* Shared patterns span child components. Keep their specificity low for local overrides. */
:where(.terminal-frame) :deep(.prompt-host) {
  color: var(--muted);
  font-weight: 650;
}
:where(.terminal-frame) :deep(.prompt-host.remote) {
  color: var(--accent);
}
:where(.terminal-frame) :deep(.milestone-announcement) {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
:where(.terminal-frame) :deep(.terminal-link) {
  min-height: 26px;
  padding: 1px 4px;
  margin-inline-start: -4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--accent);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}
:where(.terminal-frame) :deep(.transcript-prose) {
  font: 14px/1.5 var(--sans);
}
:where(.terminal-frame) :deep(.transcript-label),
:where(.terminal-frame) :deep(.transcript-detail) {
  color: var(--muted);
  font: 400 var(--transcript-meta-size, 12px)/1.35 var(--sans);
}
:where(.terminal-frame) :deep(.transcript-label) {
  font-weight: 650;
}
:where(.terminal-frame) :deep(.transcript-detail) {
  font-size: 12px;
}
:where(.terminal-frame) :deep(.transcript-list) {
  display: grid;
  grid-template-columns: fit-content(var(--list-label-width, 48%)) minmax(0, 1fr) max-content;
  column-gap: var(--space-2);
  padding: 0;
  list-style: none;
}
:where(.terminal-frame) :deep(.transcript-list-row) {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-columns: subgrid;
  align-items: baseline;
}
:where(.terminal-frame) :deep(.transcript-list-row + .transcript-list-row) {
  box-shadow: inset 0 1px var(--line);
}
.transcript {
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: auto;
  scroll-padding-block: 6px;
  padding: var(--space-2) var(--space-3) var(--space-3);
  font: 14px/1.52 var(--mono);
  overflow-wrap: anywhere;
}
.transcript::after {
  display: block;
  height: var(--transcript-scroll-space, 0px);
  overflow-anchor: none;
  content: '';
}
.transcript:focus-visible {
  outline-offset: -2px;
}
.earlier-read {
  margin-bottom: 10px;
  padding: 5px 8px;
  border-inline-start: 2px dashed var(--control);
  background: var(--surface);
}
.earlier-read-label {
  position: sticky;
  inset-block-start: 0;
  z-index: 1;
  margin-bottom: 4px;
  background: var(--surface);
}
.terminal-controls {
  position: relative;
  border-top: 1px solid var(--control);
  /* padding: 0 var(--space-2); */
  background: var(--surface);
}
.transcript-navigation {
  display: flex;
  flex-wrap: wrap;
  gap: 0 4px;
  padding-inline: var(--space-1);
  border-bottom: 1px solid var(--line);
}
.transcript-navigation button {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  min-height: 26px;
  padding: 2px 6px;
  border-color: transparent;
  background: transparent;
  font: 12px/1.25 var(--sans);
}
.transcript-navigation button:hover {
  background: var(--raised);
}
.transcript-navigation .view-outcome {
  color: var(--accent);
}
.transcript-navigation .lucide {
  --icon-size: 13px;
  flex: none;
}
.shortcuts {
  gap: 0 2px;
  margin-bottom: var(--space-1);
}
/* Reads renders into this toolbar on wide screens. */
.shortcuts :deep(> button) {
  min-height: 26px;
  padding: 2px 6px;
  font-size: 12px;
  border-color: var(--shortcut-border, transparent);
  background: transparent;
}
.shortcuts :deep(> button:hover:not(:disabled)),
.shortcuts :deep(> button[aria-expanded='true']) {
  background: var(--raised);
}
.shortcuts :deep(> button .lucide) {
  --icon-size: 13px;
}
@media (pointer: coarse) {
  .shortcuts :deep(> button) {
    min-height: 34px;
  }
}
@media (max-width: 830px), (pointer: coarse) {
  .transcript-navigation button {
    min-height: 32px;
    min-width: 32px;
  }
}
@media (max-width: 380px) {
  .transcript-navigation .latest-output .lucide {
    display: none;
  }
}
@media (max-width: 600px), (pointer: coarse) {
  :where(.terminal-frame) :deep(.terminal-link) {
    min-block-size: var(--touch-height);
    min-inline-size: var(--touch-height);
  }
}
@media (max-width: 600px) {
  .terminal-frame {
    border-inline: 0;
  }
  .shortcuts :deep(> button) {
    padding-inline: 5px;
  }
  .shortcuts :deep(> button .lucide.lucide-book-open) {
    display: none;
  }
}
@media (max-width: 830px) {
  .terminal-frame {
    --compact-text: 13px;
    --compact-meta: 11px;
    --compact-tight: 2px;
    --compact-inset: 3px;
    --compact-gap: 4px;
    --compact-section: 6px;
    --compact-control: 34px;
    --compact-leading: 1.25;
  }
  .transcript {
    --transcript-meta-size: var(--compact-meta);
    padding: var(--space-2);
    font-size: var(--compact-text);
    line-height: 1.46;
  }
  .terminal-controls {
    padding-block: var(--compact-inset);
  }
  .shortcuts {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: thin;
    margin-block-end: var(--compact-tight);
    scroll-padding-inline: var(--space-1);
  }
  .shortcuts:not(:has(> button)) {
    display: none;
  }
  .shortcuts :deep(> button) {
    flex: none;
    min-height: var(--compact-control);
  }
  .shortcuts :deep(> button:focus-visible) {
    outline-offset: -2px;
  }
}

@media (max-width: 600px) {
  .shortcuts {
    overscroll-behavior-inline: contain;
  }
}

.short-viewport .shortcuts {
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: thin;
}
.short-viewport .shortcuts :deep(> button) {
  flex: none;
}
</style>
