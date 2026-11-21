<script setup lang="ts">
import { ChevronDown, Play } from '@lucide/vue'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowReactive,
  useId,
  watch,
  watchPostEffect,
} from 'vue'
import ComposerArgument from './ComposerArgument.vue'
import ComposerMenu from './ComposerMenu.vue'
import {
  composerAction,
  composerCommand,
  commandDefinition,
  commandDraft,
  commandDraftSelection,
  commandInsertion,
  composerArguments,
  matchSuggestions,
  parseCommand,
  spaceCommand,
  type CommandName,
} from '../lib/commands'
import type { Action, Response } from '../lib/runtime'
import type { OperationBinding } from '../lib/scenario'
import { scalarSpan, type Span } from '../lib/unicode'
import { restoreComposerDraft, type ComposerSave, type Draft } from '../lib/workspace'

const props = defineProps<{
  prompt: string
  connected: boolean
  busy: boolean
  context: string
  suggestions: string[]
  operations: readonly OperationBinding[]
  initial?: ComposerSave
  execute: (action: Action, echo?: string) => Promise<Response | undefined>
}>()
const emit = defineEmits<{ action: [Action]; change: [] }>()
const id = useId()
const root = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
const tag = ref<HTMLButtonElement>()
const commandPicker = ref<HTMLButtonElement>()
const promptTools = ref<HTMLElement>()
let compositionCommit: string | undefined
const text = ref('')
const selected = ref<CommandName>()
const values = ref<string[]>([])
const activeIndex = ref(0)
const composing = ref(false)
const pending = ref(false)
const focused = ref(false)
const showSuggestions = ref(true)
const menuOpen = ref(false)
const editors = shallowReactive(new Map<number, InstanceType<typeof ComposerArgument>>())
const drafts = new Map<CommandName, Draft>()
const history: Draft[] = []
let historyIndex = 0
let scratch: Draft | undefined
const fields = computed(() =>
  selected.value ? composerArguments(selected.value, props.operations) : [],
)
const fixedFields = computed(
  () =>
    props.operations
      .find((operation) => operation.command === selected.value)
      ?.fields.filter((field) => field.fixed !== undefined) ?? [],
)
const activeEditor = computed(() => editors.get(activeIndex.value))
const canInsert = computed(
  () => Boolean(selected.value && fields.value[activeIndex.value]) && !composing.value,
)
const canReplace = computed(() => {
  const span = activeEditor.value?.context()
  return canInsert.value && Boolean(span && span.end > span.start)
})
const canInsertCommand = computed(() => !selected.value && !composing.value)
const canReuse = computed(() => !props.busy && !composing.value && !pending.value)
const matches = computed(() => {
  if (!focused.value || composing.value || !showSuggestions.value || menuOpen.value) return []
  if (!selected.value) return matchSuggestions(text.value, props.suggestions).slice(0, 5)
  const field = fields.value[activeIndex.value]
  if (
    !field ||
    field.kind === 'payload' ||
    field.kind === 'scalar' ||
    field.kind === 'text' ||
    field.kind === 'json'
  )
    return []
  const source = selected.value + ' ' + (values.value[activeIndex.value] ?? '')
  return matchSuggestions(source, props.suggestions).slice(0, 5)
})

function snapshot(): Draft {
  return {
    name: selected.value,
    text: text.value,
    values: [...values.value],
    active: activeIndex.value,
    selection: input.value
      ? { start: input.value.selectionStart ?? 0, end: input.value.selectionEnd ?? 0 }
      : undefined,
    spans: fields.value.map((_, index) => editors.get(index)?.context() ?? { start: 0, end: 0 }),
    // Older builds expect a page in saved drafts.
    tools: fields.value.map((_, index) => ({
      expanded: false,
      ...editors.get(index)?.saveView(),
      page: 0,
    })),
  }
}
function cache() {
  if (selected.value) drafts.set(selected.value, snapshot())
}
function reset() {
  compositionCommit = undefined
  selected.value = undefined
  values.value = []
  activeIndex.value = 0
  menuOpen.value = false
  text.value = ''
  composing.value = false
}
function resetComposer() {
  reset()
  drafts.clear()
  history.length = 0
  historyIndex = 0
  scratch = undefined
}
watch(
  () => props.context,
  () => {
    reset()
    drafts.clear()
    historyIndex = history.length
    scratch = undefined
  },
)
function saveComposer(submitted = false): ComposerSave {
  return {
    draft: submitted ? { text: '', values: [], active: 0, spans: [] } : snapshot(),
    drafts: [...drafts.values()],
    history: [...history],
    index: historyIndex,
    scratch,
  }
}
watchPostEffect(() => {
  snapshot()
  if (!pending.value) emit('change')
})
onMounted(() => {
  const saved = props.initial
  if (!saved) return
  if (Array.isArray(saved.drafts)) {
    for (const cached of saved.drafts) {
      const draft = restoreComposerDraft(cached)
      if (draft?.name) drafts.set(draft.name, draft)
    }
  }
  if (Array.isArray(saved.history))
    history.push(
      ...saved.history
        .map(restoreComposerDraft)
        .filter((draft) => draft !== undefined)
        .slice(-60),
    )
  historyIndex = Number.isSafeInteger(saved.index)
    ? Math.max(0, Math.min(saved.index, history.length))
    : history.length
  scratch = restoreComposerDraft(saved.scratch)
  const draft = restoreComposerDraft(saved.draft)
  if (draft) void restore(draft, false)
})
function setEditor(index: number, instance: unknown) {
  if (instance) editors.set(index, instance as InstanceType<typeof ComposerArgument>)
  else editors.delete(index)
}
async function focusField(index = activeIndex.value, span?: Span) {
  activeIndex.value = index
  await nextTick()
  const editor = editors.get(index)
  if (editor) editor.focusAt(span ?? editor.context())
  else tag.value?.focus({ preventScroll: true })
}
async function restore(draft: Draft, focus = true) {
  selected.value = draft.name
  text.value = draft.text
  values.value = [...draft.values]
  activeIndex.value = Math.min(draft.active, Math.max(0, fields.value.length - 1))
  menuOpen.value = false
  showSuggestions.value = false
  await nextTick()
  if (draft.name) {
    draft.spans.forEach((span, index) => {
      const raw = draft.values[index] ?? ''
      editors.get(index)?.focusAt(
        scalarSpan(raw, {
          start: Math.min(raw.length, span.start),
          end: Math.min(raw.length, span.end),
        }),
        false,
      )
    })
    if (focus) await focusField(activeIndex.value)
    if (Array.isArray(draft.tools))
      draft.tools.forEach((view, index) => {
        if (view) editors.get(index)?.restoreView(view)
      })
  } else {
    if (focus) input.value?.focus({ preventScroll: true })
    if (draft.selection) input.value?.setSelectionRange(draft.selection.start, draft.selection.end)
  }
}
async function selectCommand(name: CommandName, supplied?: string[]) {
  if (composing.value || props.busy) return
  cache()
  const saved = supplied === undefined ? drafts.get(name) : undefined
  if (saved) return restore(saved)
  selected.value = name
  values.value = composerArguments(name, props.operations).map(
    (field, index) => supplied?.[index] ?? field.initial,
  )
  text.value = ''
  activeIndex.value = 0
  menuOpen.value = false
  showSuggestions.value = true
  await focusField(0)
}
async function unwrap() {
  if (composing.value || props.busy) return
  cache()
  const name = selected.value ?? ''
  const raw = selected.value ? composerCommand(selected.value, values.value, fields.value) : name
  reset()
  text.value = raw
  await nextTick()
  input.value?.focus({ preventScroll: true })
  input.value?.setSelectionRange(0, name.length)
}
function endFreeComposition() {
  composing.value = false
  compositionCommit = text.value
}
function updateValue(index: number, value: string) {
  values.value[index] = value
  showSuggestions.value = true
}
function freeInput(event: Event) {
  const commit = compositionCommit
  compositionCommit = undefined
  if ((event as InputEvent).isComposing || commit === text.value) return
  showSuggestions.value = true
  const name = spaceCommand(text.value, composing.value)
  if (name) void selectCommand(name)
}
function structuredAction(): Action | undefined {
  if (!selected.value) return
  return composerAction(selected.value, values.value, props.operations)
}
async function submit() {
  if (composing.value || props.busy || pending.value) return
  const raw = text.value
  const oneLineSelection = {
    start: input.value?.selectionStart ?? raw.length,
    end: input.value?.selectionEnd ?? raw.length,
  }
  const parsed = selected.value ? undefined : commandDraft(raw)
  if (
    !selected.value &&
    parsed &&
    parsed.values.length === 0 &&
    commandDefinition(parsed.name)!.arguments.some((field) => field.required)
  ) {
    await selectCommand(parsed.name)
    return
  }
  const action = selected.value ? structuredAction() : parseCommand(raw)
  if (!action) return
  activeEditor.value?.captureSelection()
  const saved = snapshot()
  const context = props.context
  const focusedField =
    document.activeElement?.tagName === 'TEXTAREA' || document.activeElement === input.value
  const echo = selected.value ? composerCommand(selected.value, values.value, fields.value) : raw
  let historyDraft = saved
  if (
    !selected.value &&
    parsed?.values.length &&
    parsed.values.length <= commandDefinition(parsed.name)!.arguments.length
  ) {
    const fields = composerArguments(parsed.name, props.operations)
    const context = commandDraftSelection(raw, oneLineSelection)
    historyDraft = {
      name: parsed.name,
      text: '',
      values: fields.map((field, index) => parsed.values[index] ?? field.initial),
      active: context?.index ?? 0,
      spans: fields.map((_, index) =>
        index === context?.index ? context.span : { start: 0, end: 0 },
      ),
    }
  }
  const previous = history.at(-1)
  if (JSON.stringify(previous) !== JSON.stringify(historyDraft)) history.push(historyDraft)
  if (history.length > 60) history.shift()
  historyIndex = history.length
  scratch = undefined
  pending.value = true
  try {
    const response = await props.execute(action, echo)
    if (context !== props.context || !response) return
    if (response.output?.some((row) => row.kind === 'error')) {
      if (
        !selected.value &&
        parsed &&
        parsed.values.length > 0 &&
        parsed.values.length <= commandDefinition(parsed.name)!.arguments.length
      ) {
        await selectCommand(parsed.name, parsed.values)
        const context = commandDraftSelection(raw, oneLineSelection)
        if (context && context.index < fields.value.length)
          await focusField(context.index, context.span)
      } else if (focusedField && selected.value)
        await focusField(saved.active, saved.spans[saved.active])
      return
    }
    if (response.compose) return
    reset()
    showSuggestions.value = true
    if (focusedField) {
      await nextTick()
      input.value?.focus({ preventScroll: true })
    }
  } finally {
    pending.value = false
  }
}
function blocked(event: KeyboardEvent) {
  return event.isComposing || event.keyCode === 229 || composing.value
}
function recall(direction: number) {
  if (!history.length) return
  if (historyIndex === history.length) scratch = snapshot()
  historyIndex = Math.min(history.length, Math.max(0, historyIndex + direction))
  const draft = history[historyIndex] ?? scratch
  if (draft) void restore(draft)
}
function freeKey(event: KeyboardEvent) {
  if (blocked(event)) return
  if (event.key === 'Escape') showSuggestions.value = false
  else if (event.key === 'Tab' && !event.shiftKey && matches.value.length === 1) {
    event.preventDefault()
    void complete(matches.value[0])
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    recall(event.key === 'ArrowUp' ? -1 : 1)
  }
}
function argumentKey(event: KeyboardEvent, index: number) {
  if (blocked(event)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    void unwrap()
  } else if (
    event.key === 'Backspace' &&
    index === 0 &&
    !values.value[0] &&
    (event.target as HTMLTextAreaElement).selectionStart === 0
  ) {
    event.preventDefault()
    void unwrap()
  } else if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    if (index + 1 < fields.value.length) void focusField(index + 1)
    else void submit()
  } else if (event.key === 'Tab') {
    if (!event.shiftKey && matches.value.length === 1) {
      event.preventDefault()
      void complete(matches.value[0])
      return
    }
    if (event.shiftKey) {
      event.preventDefault()
      if (index === 0) tag.value?.focus()
      else void focusField(index - 1)
    }
  } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault()
    recall(event.key === 'ArrowUp' ? -1 : 1)
  }
}
function tagKey(event: KeyboardEvent) {
  if (blocked(event)) return
  if (event.key === 'Escape' || event.key === 'Backspace') {
    event.preventDefault()
    void unwrap()
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    void toggleMenu()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    if (fields.value.length) void focusField(0)
    else void submit()
  }
}

async function complete(value: string) {
  const draft = commandDraft(value)
  if (!draft) return
  if (selected.value) {
    values.value[activeIndex.value] = draft.values[0] ?? ''
    showSuggestions.value = false
    const length = values.value[activeIndex.value].length
    await focusField(activeIndex.value, { start: length, end: length })
  } else await selectCommand(draft.name, draft.values.length ? draft.values : undefined)
}
function toggleMenu() {
  if (!composing.value && !props.busy) menuOpen.value = !menuOpen.value
}

function escapeMenu() {
  menuOpen.value = false
  const trigger = tag.value ?? commandPicker.value
  trigger?.focus({ preventScroll: true })
}

function leaveMenu(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node)) menuOpen.value = false
}

function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) menuOpen.value = false
}
window.addEventListener('pointerdown', outside)
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', outside)
})
function applyText(mode: 'insert' | 'replace', value: string) {
  if (!canInsert.value) return
  const span = activeEditor.value?.context()
  if (span && (mode === 'insert' || span.start < span.end))
    activeEditor.value?.apply(
      mode === 'insert' ? { start: span.start, end: span.start } : span,
      value,
      false,
    )
}
function insertCommand(value: string) {
  if (!canInsertCommand.value || !input.value) return
  const field = input.value
  const span = scalarSpan(text.value, {
    start: field.selectionStart ?? text.value.length,
    end: field.selectionEnd ?? text.value.length,
  })
  field.setRangeText(commandInsertion(value), span.start, span.end, 'end')
  text.value = field.value
  field.focus({ preventScroll: true })
}
async function reuseCommand(value: string) {
  if (!canReuse.value) return
  historyIndex = history.length
  scratch = undefined
  const draft = commandDraft(value)
  if (draft && draft.values.length <= composerArguments(draft.name, props.operations).length) {
    const original = parseCommand(value)
    // An explicitly empty optional argument cannot round-trip through the composer.
    if (
      !draft.values.length ||
      original?.type === 'invalid' ||
      JSON.stringify(composerAction(draft.name, draft.values, props.operations)) ===
        JSON.stringify(original)
    ) {
      await selectCommand(draft.name, draft.values)
      return
    }
  }
  cache()
  reset()
  text.value = value
  showSuggestions.value = false
  await nextTick()
  input.value?.focus({ preventScroll: true })
  input.value?.setSelectionRange(value.length, value.length)
}
defineExpose({
  promptTools,
  structured: computed(() => Boolean(selected.value)),
  selectCommand,
  applyText,
  insertCommand,
  reuseCommand,
  canReuse,
  canInsert,
  canReplace,
  canInsertCommand,
  saveComposer,
  resetComposer,
  revealFocusedArgument: () => activeEditor.value?.revealEditor(),
})
</script>

<template>
  <div
    ref="root"
    class="command-composer"
    @focusin="focused = true"
    @focusout="
      (event) => {
        if (!root?.contains(event.relatedTarget as Node)) focused = false
      }
    "
  >
    <form
      class="prompt"
      :class="{ structured: selected, 'single-argument': fields.length === 1 }"
      aria-label="Command composer"
      @submit.prevent="submit"
    >
      <div class="prompt-line">
        <label
          class="prompt-host"
          :class="{ remote: connected }"
          :for="selected ? undefined : id"
          aria-hidden="true"
          >{{ connected ? '@' : '' }}{{ prompt }} ›</label
        >
        <button
          v-if="selected"
          ref="tag"
          type="button"
          class="command-tag"
          :aria-label="'Change command: ' + selected"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          :aria-controls="menuOpen ? id + '-menu' : undefined"
          :disabled="busy || composing"
          @click="toggleMenu"
          @keydown="tagKey"
        >
          {{ selected }} <ChevronDown class="disclosure-icon" aria-hidden="true" />
        </button>
        <input
          v-else
          :id="id"
          ref="input"
          v-model="text"
          aria-label="Terminal command"
          enterkeyhint="go"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          dir="auto"
          :readonly="busy"
          @input="freeInput"
          @select="emit('change')"
          @keyup="emit('change')"
          @pointerup="emit('change')"
          @keydown="freeKey"
          @compositionstart="composing = true"
          @compositionend="endFreeComposition"
        />
        <button
          v-if="!selected"
          ref="commandPicker"
          type="button"
          class="command-picker"
          aria-label="Commands"
          title="Browse commands"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          :aria-controls="menuOpen ? id + '-menu' : undefined"
          :disabled="busy || composing"
          @click="toggleMenu"
          @keydown.down.prevent="toggleMenu"
          @keydown.up.prevent="toggleMenu"
        >
          Commands
          <ChevronDown class="disclosure-icon" aria-hidden="true" />
        </button>
        <div ref="promptTools" class="prompt-tools"></div>
        <button
          type="submit"
          class="run-command"
          aria-label="Run"
          title="Run"
          :disabled="busy || composing || pending || (!selected && !text.trim())"
        >
          <Play aria-hidden="true" />
        </button>
      </div>
      <div v-if="selected && (fields.length || fixedFields.length)" class="composer-arguments">
        <div v-if="fixedFields.length" class="composer-fixed meta">
          <span v-for="field in fixedFields" :key="field.input"
            ><bdi>{{ field.label }}</bdi> <bdi>{{ field.fixed }}</bdi></span
          >
        </div>
        <ComposerArgument
          v-for="(field, index) in fields"
          :key="selected + '/' + field.name"
          :ref="(instance) => setEditor(index, instance)"
          :label="field.label"
          :size-key="selected + '/' + field.name"
          :inline="fields.length === 1"
          :model-value="values[index] ?? ''"
          :active="activeIndex === index"
          :inspectors="field.inspectors ?? []"
          :literal="field.kind === 'json'"
          :last="index === fields.length - 1"
          :disabled="busy || pending"
          @update:model-value="updateValue(index, $event)"
          @activate="activeIndex = index"
          @composition="composing = $event"
          @key="argumentKey($event, index)"
          @inspect="emit('action', { type: 'inspect', character: $event })"
          @copy="emit('action', { type: 'copy', text: $event })"
        />
      </div>
    </form>
    <ComposerMenu
      v-if="menuOpen"
      :id="id + '-menu'"
      :anchor="root"
      :selected="selected"
      :suggestions="suggestions"
      :operations="operations"
      :composing="composing"
      @select="selectCommand"
      @unwrap="unwrap"
      @escape="escapeMenu"
      @focusout="leaveMenu"
    />
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
</template>

<style scoped>
.prompt .command-picker {
  display: none;
}
.suggestions button {
  min-height: 26px;
  padding: 2px 6px;
  font-size: 12px;
}
.prompt {
  display: block;
  padding-inline-start: 7px;
  /* border-inline-start: 2px solid var(--control); */
  background: var(--inset);
  font-family: var(--mono);
}
.prompt:focus-within {
  border-inline-start-color: var(--accent);
  background: #192a28;
}
.prompt label {
  cursor: text;
}
.prompt-host {
  max-width: 22%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prompt input {
  flex: 1;
  min-width: 0;
  padding-inline: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  caret-color: var(--accent);
}
.prompt input:focus {
  outline: none;
}
/* Reads and its file shortcut teleport into the prompt on compact layouts. */
.prompt button,
.prompt-tools :deep(> button) {
  border-color: transparent;
  background: transparent;
  font-size: 12px;
}
.prompt button:disabled,
.prompt-tools :deep(> button:disabled) {
  color: var(--muted);
}
.prompt button.run-command {
  border-color: transparent;
  background: var(--raised);
  color: var(--accent);
  font-weight: 700;
}
.prompt button.run-command:disabled {
  background: transparent;
  color: var(--muted);
}
.prompt button.run-command:hover:not(:disabled) {
  background: var(--accent);
  color: var(--accent-ink);
}
.suggestions {
  position: absolute;
  z-index: 1;
  inset: auto auto calc(100% + 1px) 8px;
  width: max-content;
  max-width: calc(100% - 16px);
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--control);
  background: var(--surface);
  font-family: var(--mono);
}
.suggestions button {
  max-width: 100%;
  overflow-wrap: anywhere;
}
@media (max-width: 600px), (pointer: coarse) {
  .suggestions button {
    min-height: 34px;
  }
}
@media (max-width: 600px) {
  .prompt-host {
    max-width: 30%;
    font-size: 12px;
  }
  .prompt input {
    font-size: 16px;
  }
}
.command-composer {
  position: relative;
  min-width: 0;
}
.prompt-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.prompt-line .prompt-host {
  flex: none;
}
.prompt .command-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--control-height);
  padding: 2px 6px;
  border: 1px solid var(--control);
  border-radius: 2px;
  font-size: inherit;
  line-height: 1.3;
}
.prompt .prompt-tools {
  margin-inline-start: auto;
}
.prompt .run-command {
  margin-inline-start: auto;
  flex: none;
}
.prompt-tools:empty {
  display: none;
}
.composer-arguments {
  --argument-size-limit: min(calc(var(--app-height, 100dvh) * 0.32), 240px);
  --argument-body-limit: var(--argument-size-limit);
  max-height: var(--argument-body-limit);
  overflow: auto;
  overscroll-behavior: contain;
  padding-inline-end: 4px;
}
@media (max-width: 600px), (pointer: coarse) {
  .prompt .command-tag,
  .prompt .run-command {
    min-height: var(--touch-height);
  }
}

.composer-fixed {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 16px;
  padding-block: 2px;
}

.composer-fixed > span {
  display: inline-flex;
  gap: 6px;
}

.prompt.single-argument {
  display: grid;
  grid-template-columns:
    minmax(0, max-content) max-content minmax(24px, 1fr)
    max-content max-content;
  align-items: center;
  column-gap: 6px;
}
.single-argument .prompt-line,
.single-argument .composer-arguments {
  display: contents;
}
.single-argument .prompt-host {
  grid-column: 1;
  grid-row: 1;
  max-width: min(22vw, 14ch);
}
.single-argument .command-tag {
  grid-column: 2;
  grid-row: 1;
}
.single-argument .run-command {
  grid-column: 5;
  grid-row: 1;
}
.single-argument .prompt-tools {
  grid-column: 4;
  grid-row: 1;
}
.single-argument .composer-fixed {
  grid-column: 1 / -1;
  grid-row: 2;
}
.short-viewport .composer-arguments {
  --argument-size-limit: min(150px, calc(var(--app-height, 100dvh) * 0.32));
  --argument-body-limit: min(var(--argument-size-limit), var(--composer-detail-budget, 100dvh));
}
.composer-arguments:has(.resized-editor) {
  --argument-size-limit: min(420px, calc(var(--app-height, 100dvh) * 0.54));
}
.short-viewport .composer-arguments:has(.resized-editor) {
  --argument-size-limit: calc(var(--app-height, 100dvh) * 0.42);
}
@media (max-width: 600px) {
  .prompt.single-argument {
    grid-template-columns: minmax(0, 1fr);
  }
  .single-argument .prompt-line {
    display: flex;
    grid-column: 1 / -1;
  }
}
@media (max-width: 830px) {
  .prompt .command-picker {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--compact-tight);
    padding-inline: var(--compact-gap);
    color: var(--muted);
    font: 600 12px / var(--compact-leading) var(--sans);
  }
  .prompt .command-picker[aria-expanded='true'] {
    color: var(--accent);
    background: var(--raised);
  }
  .prompt .command-picker[aria-expanded='true'] .disclosure-icon {
    rotate: 180deg;
  }
  .prompt:focus-within {
    background: var(--inset);
  }
  .prompt-line {
    gap: var(--compact-gap);
  }
  .prompt-line .prompt-host {
    flex: 0 1 auto;
    min-width: 0;
  }
  .prompt-line :is(input, button),
  .prompt-tools :deep(> button),
  .prompt :is(.command-tag, .run-command) {
    min-height: 1em;
    padding-block: var(--compact-inset);
  }
  .prompt .run-command,
  .prompt .command-picker,
  .prompt-tools :deep(> button) {
    min-inline-size: var(--touch-height);
    min-block-size: var(--touch-height);
  }
  .prompt .run-command {
    margin-inline-start: 0;
    padding-inline: 6px;
  }
  .prompt-tools {
    display: flex;
    gap: var(--compact-tight);
  }
  .prompt-tools :deep(> button) {
    padding-inline: var(--compact-gap);
    color: var(--muted);
    font: 600 var(--compact-meta) / var(--compact-leading) var(--sans);
  }
  .prompt-tools :deep(> button .lucide) {
    /* display: none; */
  }
  .prompt-tools :deep(> button[aria-expanded='true']) {
    color: var(--accent);
    background: var(--raised);
  }
}

@media (max-width: 600px) {
  .composer-arguments {
    display: grid;
    gap: var(--compact-gap);
    scrollbar-width: thin;
    padding-inline-end: var(--space-1);
  }
  .composer-fixed {
    font-size: var(--compact-meta);
    line-height: var(--compact-leading);
  }
}
@media (max-width: 360px) {
  .prompt:not(.structured) .prompt-host {
    max-width: 24%;
  }
  .prompt:not(.structured) .prompt-line {
    gap: 2px;
  }
  .prompt .command-picker {
    gap: 0;
    padding-inline: 2px;
  }
  .command-picker .disclosure-icon {
    --icon-size: 10px;
  }
}
</style>
