<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import TerminalFile from './TerminalFile.vue'
import { commandHelp, parseCommand } from '../lib/commands'
import type { Action, Link, Output } from '../lib/runtime'

export interface Entry {
  id: number
  echo?: string
  prompt?: string
  output: Output[]
}

const props = defineProps<{
  transcript: Entry[]
  prompt: string
  shortcuts: Link[]
  suggestions: string[]
  busy: boolean
}>()
const emit = defineEmits<{ action: [Action, string?] }>()
const scroll = ref<HTMLDivElement>()
const input = ref<HTMLInputElement>()
const command = ref('')
const showSuggestions = ref(true)
const composing = ref(false)
const hasFocus = ref(false)
const commandGroup = ref<HTMLElement>()
const quickActions = ref<HTMLElement>()
const following = ref(true)
const history: string[] = []
let index = 0
let scratch = ''
const matches = computed(() =>
  hasFocus.value && !composing.value && showSuggestions.value && command.value.trimStart()
    ? props.suggestions
        .filter(
          (item) =>
            item.startsWith(command.value.trimStart()) && item !== command.value.trimStart(),
        )
        .slice(0, 5)
    : [],
)

function scrollToEnd() {
  if (scroll.value) scroll.value.scrollTop = scroll.value.scrollHeight
  following.value = true
}

function trackScroll() {
  const box = scroll.value
  if (box) following.value = box.scrollHeight - box.scrollTop - box.clientHeight < 28
}

watch(
  () => props.transcript,
  () => {
    if (following.value) scrollToEnd()
  },
  { flush: 'post' },
)

function submit() {
  if (composing.value || props.busy) return
  const raw = command.value
  const action = parseCommand(raw)
  if (!action) return
  if (history.at(-1) !== raw) history.push(raw)
  if (history.length > 60) history.shift()
  index = history.length
  scratch = ''
  command.value = ''
  showSuggestions.value = true
  emit('action', action, raw)
}

function keydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229 || composing.value) return
  if (event.key === 'Escape') showSuggestions.value = false
  if (event.key === 'Tab' && !event.shiftKey && matches.value.length === 1) {
    event.preventDefault()
    complete(matches.value[0])
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    if (!history.length) return
    event.preventDefault()
    if (index === history.length) scratch = command.value
    index = Math.min(history.length, Math.max(0, index + (event.key === 'ArrowUp' ? -1 : 1)))
    command.value = history[index] ?? scratch
    showSuggestions.value = false
  }
}

function focusout(event: FocusEvent) {
  if (!commandGroup.value?.contains(event.relatedTarget as Node | null)) hasFocus.value = false
}

function complete(value: string) {
  command.value = value
  showSuggestions.value = false
  input.value?.focus()
}

function focusAction(type: 'login' | 'ls') {
  quickActions.value
    ?.querySelector<HTMLButtonElement>(`[data-action="${type}"]`)
    ?.focus({ preventScroll: true })
}

defineExpose({ focusAction, scrollToEnd })
</script>

<template>
  <section class="terminal-frame" aria-label="Terminal">
    <div class="frame-title">
      <h2>Terminal</h2>
      <button v-if="!following" type="button" class="jump" @click="scrollToEnd">
        Latest output ↓
      </button>
    </div>
    <div
      ref="scroll"
      class="transcript"
      role="log"
      aria-label="Terminal transcript"
      tabindex="0"
      @scroll="trackScroll"
    >
      <article v-for="entry in transcript" :key="entry.id" class="terminal-entry">
        <p v-if="entry.echo !== undefined" class="command-echo">
          <span aria-hidden="true">{{ entry.prompt }} › </span><bdi>{{ entry.echo }}</bdi>
        </p>
        <template v-for="(row, index) in entry.output" :key="index">
          <div v-if="row.kind === 'listing'" class="terminal-list">
            <p class="listing-path">
              <bdi>{{ row.path ?? 'Known hosts' }}</bdi>
            </p>
            <p v-if="!row.links.length" class="meta">Empty directory.</p>
            <ul v-else>
              <li v-for="link in row.links" :key="link.label">
                <button type="button" class="terminal-link" @click="emit('action', link.action)">
                  <bdi>{{ link.label }}</bdi>
                </button>
                <span v-if="link.detail" class="listing-detail"
                  ><bdi>{{ link.detail }}</bdi></span
                >
              </li>
            </ul>
          </div>
          <TerminalFile
            v-else-if="row.kind === 'file'"
            :path="row.path"
            :text="row.text"
            :inspect-lines="row.inspectLines"
            @action="emit('action', $event)"
          />
          <div v-else-if="row.kind === 'help'" class="command-help">
            <dl>
              <template v-for="[usage, detail] in commandHelp" :key="usage">
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
      </article>
    </div>
    <div class="terminal-controls">
      <div ref="quickActions" class="toolbar shortcuts" aria-label="Quick actions" role="group">
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
      </div>
      <div ref="commandGroup" @focusin="hasFocus = true" @focusout="focusout">
        <form class="prompt" @submit.prevent="submit">
          <span class="prompt-host" aria-hidden="true">{{ prompt }} ›</span>
          <input
            ref="input"
            v-model="command"
            aria-label="Terminal command"
            placeholder="Enter a command"
            enterkeyhint="go"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            dir="auto"
            @input="showSuggestions = true"
            @keydown="keydown"
            @compositionstart="composing = true"
            @compositionend="composing = false"
          />
          <button type="submit" :disabled="busy || composing || !command.trim()">Run</button>
        </form>
        <div
          v-if="matches.length"
          class="suggestions toolbar"
          aria-label="Command suggestions"
          role="group"
          @mousedown.prevent
        >
          <button v-for="item in matches" :key="item" type="button" @click="complete(item)">
            {{ item }}
          </button>
          <span v-if="matches.length === 1" class="meta tab-hint">Tab to complete</span>
        </div>
      </div>
    </div>
  </section>
</template>
