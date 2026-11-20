<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useId } from 'vue'
import CommandComposer from './CommandComposer.vue'
import TerminalEntry from './TerminalEntry.vue'
import TerminalReads from './TerminalReads.vue'
import TerminalResource from './TerminalResource.vue'
import { useTerminalTranscript } from '../composables/useTerminalTranscript'
import type { CommandName } from '../lib/commands'
import type { Action, Link, Response, Session } from '../lib/runtime'
import type { OperationBinding } from '../lib/scenario'
import { notation } from '../lib/unicode'
import type { ComposerSave, Entry } from '../lib/workspace'

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
  activity: Pick<Session, 'visitedHosts' | 'deliveredMail' | 'readMail' | 'readResources'>
  initialComposer?: ComposerSave
  execute: (action: Action, echo?: string) => Promise<Response | undefined>
}>()
const emit = defineEmits<{ action: [Action, string?]; change: [] }>()
const outputPrefix = useId() + '-output-'
const scroll = ref<HTMLDivElement>()
const frame = ref<HTMLElement>()
const composer = ref<InstanceType<typeof CommandComposer>>()
const readsControls = ref<InstanceType<typeof TerminalReads>>()
const compactLayout = window.matchMedia('(max-width: 830px)')
const compact = ref(compactLayout.matches)
const updateCompact = () => (compact.value = compactLayout.matches)
const {
  following,
  unseenProgress,
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
  showResult,
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

onMounted(() => compactLayout.addEventListener('change', updateCompact))
onUnmounted(() => compactLayout.removeEventListener('change', updateCompact))

async function openTitleList(type: 'hosts' | 'mail') {
  const response = await props.execute({ type, scope: 'local' })
  if (response?.output?.[0]?.kind === 'listing') {
    await nextTick()
    revealOutput('list', true)
  }
}

function showLatest(event: MouseEvent) {
  latest()
  if (event.detail === 0) focusTranscript()
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
    <slot name="title" v-bind="{ following, unseenProgress, openTitleList, showLatest }" />
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
      </section>
      <TerminalEntry
        v-for="entry in transcript"
        :key="entry.id"
        :entry="entry"
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
    <div class="terminal-controls">
      <div class="toolbar shortcuts" aria-label="Quick actions" role="group">
        <TerminalReads
          ref="readsControls"
          :reads="reads"
          :can-go-back="reading && !resultReturn"
          :result="result"
          :can-return-to-read="Boolean(resultReturn)"
          :trigger-target="compact ? composer?.promptTools : undefined"
          @open="openRead"
          @back="back"
          @result="showResult"
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
  max-inline-size: 1200px;
  justify-self: center;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--line);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: max-content minmax(60px, 1fr) auto;
  background: var(--inset);
}
.short-viewport .terminal-frame {
  grid-template-rows: max-content minmax(72px, 1fr) auto;
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
  border-inline-start: 2px dashed var(--muted);
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
