<script setup lang="ts">
import { ChevronDown } from '@lucide/vue'
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
import {
  actionCommand,
  composerAction,
  commandDefinition,
  commandDraft,
  commandDraftSelection,
  commandInsertion,
  commandRegistry,
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
const runButton = ref<HTMLButtonElement>()
let compositionCommit: string | undefined
const menu = ref<HTMLElement>()
const text = ref('')
const selected = ref<CommandName>()
const values = ref<string[]>([])
const activeIndex = ref(0)
const composing = ref(false)
const pending = ref(false)
const focused = ref(false)
const showSuggestions = ref(true)
const menuOpen = ref(false)
const menuIndex = ref(0)
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
const available = computed(() => {
  const names = new Set(props.suggestions)
  const operations = new Set<string>(props.operations.map(({ command }) => command))
  const local = selected.value?.startsWith('local ')
  const priority = (name: CommandName) => {
    if (local && name.startsWith('local ')) return 2
    return operations.has(name) ? 1 : 0
  }
  return commandRegistry
    .filter((command) => names.has(command.name))
    .sort((a, b) => priority(b.name) - priority(a.name))
})
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
    tools: fields.value.map(
      (_, index) => editors.get(index)?.saveView() ?? { expanded: false, page: 0 },
    ),
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
const menuResize = new ResizeObserver(fitMenu)

function fitMenu() {
  const composer = root.value
  if (!menu.value || !composer) return
  const viewportTop = window.visualViewport?.offsetTop ?? 0
  const available = composer.getBoundingClientRect().top - viewportTop - 8
  menu.value.style.setProperty('--menu-space', `${Math.max(0, available)}px`)
}

onMounted(() => {
  if (root.value) menuResize.observe(root.value)
  menuResize.observe(document.documentElement)
  window.visualViewport?.addEventListener('resize', fitMenu)
  window.visualViewport?.addEventListener('scroll', fitMenu)
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
  // Decode only for serialization. The command-scoped draft keeps its original spelling.
  const action = structuredAction()
  const name = selected.value ?? ''
  const raw = action?.type !== 'invalid' && action ? (actionCommand(action) ?? name) : name
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
  const echo = selected.value ? actionCommand(action) : raw
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
    event.preventDefault()
    if (event.shiftKey && index === 0) tag.value?.focus()
    else if (!event.shiftKey && index + 1 === fields.value.length) runButton.value?.focus()
    else void focusField(index + (event.shiftKey ? -1 : 1))
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
  } else if (
    (event.key === 'Tab' && !event.shiftKey && fields.value.length) ||
    event.key === 'Enter'
  ) {
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
async function toggleMenu() {
  if (composing.value || props.busy) return
  menuOpen.value = !menuOpen.value
  menuIndex.value = Math.max(
    0,
    available.value.findIndex((command) => command.name === selected.value),
  )
  if (menuOpen.value) {
    await nextTick()
    fitMenu()
    menu.value?.querySelectorAll<HTMLButtonElement>('button')[menuIndex.value]?.focus()
  }
}
function menuKey(event: KeyboardEvent) {
  if (blocked(event)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    menuOpen.value = false
    tag.value?.focus()
    return
  }
  const count = available.value.length + 1
  if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    menuIndex.value =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? count - 1
          : (menuIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
    menu.value?.querySelectorAll<HTMLButtonElement>('button')[menuIndex.value]?.focus()
  }
}
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) menuOpen.value = false
}
window.addEventListener('pointerdown', outside)
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', outside)
  window.visualViewport?.removeEventListener('resize', fitMenu)
  window.visualViewport?.removeEventListener('scroll', fitMenu)
  menuResize.disconnect()
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
          ref="runButton"
          type="submit"
          class="run-command"
          :disabled="busy || composing || pending || (!selected && !text.trim())"
        >
          Run
        </button>
      </div>
      <div v-if="fixedFields.length" class="composer-fixed meta">
        <span v-for="field in fixedFields" :key="field.input"
          ><bdi>{{ field.label }}</bdi> <bdi>{{ field.fixed }}</bdi></span
        >
      </div>
      <div v-if="selected && fields.length" class="composer-arguments">
        <ComposerArgument
          v-for="(field, index) in fields"
          :key="selected + '/' + field.name"
          :ref="(instance) => setEditor(index, instance)"
          :label="field.label"
          :inline="fields.length === 1"
          :model-value="values[index] ?? ''"
          :active="activeIndex === index"
          :unicode="field.kind === 'payload' || field.kind === 'scalar' || field.kind === 'json'"
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
    <div
      v-if="menuOpen"
      :id="id + '-menu'"
      ref="menu"
      class="command-menu"
      role="menu"
      aria-label="Commands"
      @keydown="menuKey"
      @focusout="
        (event) => {
          if (!root?.contains(event.relatedTarget as Node)) menuOpen = false
        }
      "
    >
      <button
        v-for="(command, index) in available"
        :key="command.name"
        type="button"
        role="menuitemradio"
        :aria-checked="selected === command.name"
        :tabindex="index === menuIndex ? 0 : -1"
        @click="selectCommand(command.name)"
      >
        <span>{{ command.usage }}</span
        ><span class="meta">{{ command.description }}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        :tabindex="menuIndex === available.length ? 0 : -1"
        @click="unwrap"
      >
        Edit command name…
      </button>
    </div>
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
