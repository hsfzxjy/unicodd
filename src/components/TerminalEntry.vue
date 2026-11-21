<script setup lang="ts">
import { ChevronDown, ChevronRight, Mail, Pencil } from '@lucide/vue'
import { computed } from 'vue'
import ConsoleControls from './ConsoleControls.vue'
import TerminalInspection from './TerminalInspection.vue'
import TerminalListing from './TerminalListing.vue'
import TerminalProgress from './TerminalProgress.vue'
import TerminalReport from './TerminalReport.vue'
import TerminalResource from './TerminalResource.vue'
import type { TerminalEntryView } from '../composables/terminal-presentation'
import { commandDefinition, commandEcho, commandRegistry, type CommandName } from '../lib/commands'
import type { Action, Output, ProgressTransition, Session } from '../lib/runtime'

const props = defineProps<{
  entry: TerminalEntryView
  openingDirectory?: Extract<Output, { kind: 'listing' }>
  omitRow?: Output
  outputId: string
  collapsed: boolean
  activity: Pick<Session, 'visitedHosts' | 'deliveredMail' | 'readMail' | 'readResources'>
  prompt: string
  connected: boolean
  busy: boolean
  canReuse: boolean
  canInsert: boolean
  canInsertCommand: boolean
  canReplace: boolean
}>()
const emit = defineEmits<{
  action: [Action]
  compose: [CommandName]
  toggle: []
  mail: []
  reuse: [string]
}>()

const collapsedProgress = computed(() => {
  if (!props.collapsed) return
  let scope: ProgressTransition['scope'] | undefined
  for (const row of props.entry.output) {
    if (!('progress' in row) || !row.progress) continue
    if (row.progress.scope === 'scenario') return 'scenario'
    scope = row.progress.scope
  }
  return scope
})

function helpCommand(name: CommandName, referenceConnected: boolean) {
  // Local help prints console command names without the prefix.
  if (props.connected && !referenceConnected)
    return commandDefinition(`local ${name}`)?.name ?? name
  return name
}

function echoText(value: string) {
  if (value.length <= 512) return value
  const limit =
    /[\uD800-\uDBFF]/u.test(value[511]) && /[\uDC00-\uDFFF]/u.test(value[512]) ? 511 : 512
  return value.slice(0, limit) + '…'
}
</script>

<template>
  <article
    :data-entry-id="entry.id"
    class="terminal-entry"
    tabindex="-1"
    :class="{ 'has-command': entry.echo !== undefined, 'remote-entry': entry.connected }"
  >
    <div
      v-if="entry.echo !== undefined"
      class="command-echo"
      :class="{ remote: entry.connected }"
      @click="emit('toggle')"
    >
      <p class="command-line">
        <span class="prompt-host" :class="{ remote: entry.connected }"
          >{{ entry.connected ? '@' : '' }}{{ entry.prompt }} ›</span
        >
        <bdi>{{
          echoText(
            commandEcho(entry.localScope ? entry.echo.replace(/^\s*local\s+/u, '') : entry.echo),
          )
        }}</bdi>
      </p>
      <div class="entry-actions">
        <button
          type="button"
          class="icon-button"
          aria-label="Edit this command"
          title="Load this command into the prompt for editing"
          :disabled="!canReuse"
          @click.stop="emit('reuse', entry.echo)"
        >
          <Pencil aria-hidden="true" />
        </button>
        <button
          v-if="entry.output.length || entry.waiting"
          type="button"
          class="icon-button output-toggle"
          :class="{ 'collapsed-progress': collapsedProgress }"
          :data-scope="collapsedProgress"
          aria-label="Toggle command output"
          :aria-controls="outputId"
          :aria-expanded="!collapsed"
          :title="collapsed ? 'Show output' : 'Hide output'"
          @click.stop="emit('toggle')"
        >
          <ChevronRight v-if="collapsed" aria-hidden="true" />
          <ChevronDown v-else aria-hidden="true" />
        </button>
      </div>
    </div>
    <div
      v-if="entry.output.length || entry.waiting"
      v-show="!collapsed"
      :id="outputId"
      class="entry-body"
    >
      <div
        v-if="entry.output.length"
        class="entry-output"
        :class="{ 'opening-read': openingDirectory }"
      >
        <p v-if="entry.arrival" class="arrival">
          <bdi class="arrival-host">@{{ entry.arrival.host }}</bdi> ·
          <bdi>{{ entry.arrival.role }}</bdi>
        </p>
        <template v-for="(row, index) in entry.output" :key="index">
          <template v-if="row === omitRow"></template>
          <TerminalListing
            v-else-if="row.kind === 'listing'"
            :row="row"
            :activity="activity"
            :prompt="prompt"
            :connected="connected"
            :busy="busy"
            @action="emit('action', $event)"
          />
          <TerminalResource
            v-else-if="row.kind === 'file' || row.kind === 'mail'"
            :output="row"
            :busy="busy"
            @action="emit('action', $event)"
          />
          <template v-else-if="row.kind === 'mailNotice'">
            <button
              v-if="activity.deliveredMail.some((id) => !activity.readMail.includes(id))"
              type="button"
              class="terminal-link mail-notice transcript-label"
              aria-label="New mail, open local inbox"
              :aria-disabled="busy || undefined"
              @click="emit('mail')"
            >
              <Mail aria-hidden="true" /> New mail
            </button>
          </template>
          <TerminalInspection
            v-else-if="row.kind === 'inspection'"
            :row="row"
            :can-insert-payload="canInsert"
            :can-insert-command="canInsertCommand"
            :can-replace="canReplace"
            :busy="busy"
            @action="emit('action', $event)"
          />
          <TerminalReport
            v-else-if="row.kind === 'report'"
            :rows="row.rows"
            :busy="busy"
            :can-insert="canInsert"
            :can-replace="canReplace"
            @action="emit('action', $event)"
          />
          <section
            v-else-if="row.kind === 'help'"
            class="command-help"
            aria-label="Command reference"
            tabindex="-1"
          >
            <ConsoleControls />
            <dl class="transcript-list">
              <div
                v-for="{ name, usage, description } in commandRegistry.filter(({ name }) =>
                  row.commands.includes(name),
                )"
                :key="name"
                class="transcript-list-row"
              >
                <dt>
                  <button
                    type="button"
                    class="terminal-link"
                    :title="'Edit ' + helpCommand(name, row.connected)"
                    :disabled="!canReuse"
                    @click="emit('compose', helpCommand(name, row.connected))"
                  >
                    {{ usage }}
                  </button>
                </dt>
                <dd class="transcript-detail">{{ description }}</dd>
              </div>
            </dl>
            <p class="transcript-detail">
              {{
                row.connected
                  ? 'File paths start at this host’s root. The title bar opens local mail and hosts without disconnecting.'
                  : 'This console opens remote sessions and holds your inbox and campaign.'
              }}
            </p>
          </section>
          <TerminalProgress
            v-else-if="(row.kind === 'milestone' || row.kind === 'objective') && row.progress"
            :progress="row.progress"
            :fresh="Boolean(entry.freshProgress)"
          />
          <p
            v-else
            :tabindex="row.kind === 'error' || index === 0 ? -1 : undefined"
            :class="[
              'terminal-line',
              row.kind,
              row.kind === 'message' &&
                index === 0 &&
                entry.output.some(({ kind }) => kind === 'report') &&
                'report-lead',
              row.kind === 'message' && row.narrative && 'transcript-prose',
            ]"
            dir="auto"
          >
            {{ row.text }}
          </p>
        </template>
        <TerminalListing
          v-if="openingDirectory"
          class="opening-directory"
          :row="openingDirectory"
          :activity="activity"
          :prompt="prompt"
          :connected="connected"
          :busy="busy"
          @action="emit('action', $event)"
        />
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
</template>

<style scoped>
.terminal-line.auth,
.terminal-line.objective {
  color: var(--accent);
}
.terminal-entry + .terminal-entry {
  margin-top: var(--space-2);
}
.terminal-entry.has-command {
  border-inline-start: 2px solid #506466;
}
.terminal-entry.remote-entry {
  border-inline-start-color: #536d72;
}
.command-echo {
  display: flex;
  align-items: flex-start;
  background: #1d282b;
  box-shadow: inset 0 -1px #304346;
  color: var(--text);
  cursor: pointer;
}
.command-echo.remote {
  background: #1d2b30;
}
.command-line {
  display: flex;
  flex: 1;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  padding: 4px 6px;
  font-weight: 550;
  white-space: pre-wrap;
}
.command-line .prompt-host {
  flex: none;
  max-width: 42%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.command-line bdi {
  min-width: 0;
}
.entry-actions {
  display: flex;
  flex: none;
}
.entry-actions button {
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
}
.entry-actions button:hover:not(:disabled) {
  color: var(--text);
}
.entry-actions button:focus-visible {
  outline-offset: -2px;
}
.entry-actions .collapsed-progress {
  background: var(--verification-fill);
  color: var(--verification-ink);
}
.entry-actions .collapsed-progress[data-scope='scenario'] {
  background: var(--completion-fill);
  color: var(--completion-ink);
}
.has-command .entry-body {
  padding: var(--space-1) var(--space-2) 6px;
  background: var(--surface);
}
.has-command .entry-body:has(> .entry-output:only-child > .terminal-mail:only-child) {
  background: transparent;
}
.has-command .entry-body:has(> .opening-read) {
  background: transparent;
}
.opening-read {
  --mail-inset: var(--reading-inset);
}
.opening-read :deep(.terminal-mail) {
  border-block-start: var(--terminal-rule);
}
.opening-directory {
  max-inline-size: 42rem;
  margin-block-start: var(--space-1);
  padding-inline: var(--reading-inset);
}
.arrival {
  margin-block-end: var(--space-1);
  color: var(--muted);
  font: 12px/1.35 var(--sans);
}
.arrival-host {
  color: var(--text);
  font-family: var(--mono);
  font-weight: 650;
}
.terminal-line {
  white-space: pre-wrap;
}
.terminal-line.transcript-prose {
  max-inline-size: 76ch;
}
.terminal-line.report-lead {
  font: 550 14px/1.45 var(--sans);
  margin-block-end: 4px;
}
.terminal-line + .terminal-line {
  margin-top: var(--space-1);
}
.terminal-line.error {
  padding-inline-start: 6px;
  border-inline-start: 2px solid #d98a80;
  background: #362729;
}
.output-wait {
  margin-top: 2px;
}
.terminal-line.objective {
  margin: 8px 0 0;
  padding: 0;
  border: 0;
}
.mail-notice {
  --icon-size: 13px;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--accent);
}
.command-help dl {
  --list-label-width: 55%;
  margin: 3px 0 8px;
}
.command-help button {
  text-align: start;
}
.command-help dd {
  margin: 0;
}
@media (max-width: 830px) {
  .command-help :is(dl, .transcript-list-row) {
    grid-template-columns: minmax(0, 1fr);
  }
  .command-help .transcript-list-row + .transcript-list-row {
    margin-top: var(--space-1);
  }
}
@media (max-width: 600px), (pointer: coarse) {
  .command-line {
    padding-block: 6px;
  }
}
@media (max-width: 600px) {
  .command-line .prompt-host {
    font-size: 12px;
  }
}
@media (max-width: 600px) {
  .command-line {
    padding-block: 6px;
  }
}
</style>
