<script setup lang="ts">
import { ChevronDown, ChevronRight, Mail, Pencil } from '@lucide/vue'
import TerminalInspection from './TerminalInspection.vue'
import TerminalListing from './TerminalListing.vue'
import TerminalProgress from './TerminalProgress.vue'
import TerminalReport from './TerminalReport.vue'
import TerminalResource from './TerminalResource.vue'
import { commandDefinition, commandRegistry, type CommandName } from '../lib/commands'
import type { Action, Session } from '../lib/runtime'
import type { Entry } from '../lib/workspace'

const props = defineProps<{
  entry: Entry
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
          echoText(entry.localScope ? entry.echo.replace(/^\s*local\s+/u, '') : entry.echo)
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
          :class="{
            'collapsed-progress':
              collapsed && entry.output.some((row) => 'progress' in row && row.progress),
          }"
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
      <div v-if="entry.output.length" class="entry-output">
        <template v-for="(row, index) in entry.output" :key="index">
          <TerminalListing
            v-if="row.kind === 'listing'"
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
          <div v-else-if="row.kind === 'help'" class="command-help">
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
          </div>
          <TerminalProgress
            v-else-if="(row.kind === 'milestone' || row.kind === 'objective') && row.progress"
            :progress="row.progress"
            :fresh="Boolean(entry.freshProgress)"
          />
          <p
            v-else
            :class="[
              'terminal-line',
              row.kind,
              row.kind === 'message' && row.narrative && 'transcript-prose',
            ]"
            dir="auto"
          >
            {{ row.text }}
          </p>
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
  border-inline-start: 2px solid #7f95a5;
}
.terminal-entry.remote-entry {
  border-inline-start-color: #698799;
}
.command-echo {
  display: flex;
  align-items: flex-start;
  background: #27343e;
  color: var(--text);
  cursor: pointer;
}
.command-echo.remote {
  background: #22343e;
}
.command-line {
  display: flex;
  flex: 1;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  padding: 4px 6px;
  font-weight: 650;
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
.entry-actions .output-toggle {
  color: var(--accent);
}
.entry-actions .collapsed-progress {
  background: #294b42;
  color: var(--text);
}
.has-command .entry-body {
  padding: var(--space-1) var(--space-2) 6px;
  background: var(--surface);
}
.terminal-line {
  white-space: pre-wrap;
}
.terminal-line.transcript-prose {
  max-inline-size: 76ch;
}
.terminal-line + .terminal-line {
  margin-top: var(--space-1);
}
.terminal-line.error {
  padding-inline-start: 6px;
  border-inline-start: 2px solid var(--error);
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
