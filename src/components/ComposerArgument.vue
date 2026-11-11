<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import {
  applyNativeEdit,
  editorText,
  inspect,
  inspectRange,
  pointIndex,
  rawOffset,
  readUnicodeEscape,
  scalarSpan,
  type Span,
} from '../lib/unicode'

const props = defineProps<{
  label: string
  modelValue: string
  inline: boolean
  active: boolean
  unicode: boolean
  disabled: boolean
  last: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [string]
  inspect: [string]
  copy: [string]
  composition: [boolean]
  activate: []
  key: [KeyboardEvent]
}>()
const id = useId()
const control = ref<HTMLTextAreaElement>()
const expanded = ref(false)
const selection = ref<Span>({ start: 0, end: 0 })
const page = ref(0)
const narrow = matchMedia('(max-width: 600px)')
const pageSize = ref(narrow.matches ? 16 : 48)
let composing = false
let before: Span | undefined
let projection: { raw: string; start: number; end: number } | undefined
const selected = computed(() => props.modelValue.slice(selection.value.start, selection.value.end))
const caretOffset = computed(() =>
  selection.value.start === selection.value.end ? selection.value.start : undefined,
)
const selectedScalar = computed(() => {
  const point = inspectRange(selected.value, 0, 1)[0]
  if (point?.valid && point.end === selected.value.length) return point.scalar
  const escape = readUnicodeEscape(selected.value, 0)
  if (escape && 'text' in escape && escape.end === selected.value.length) return escape.text
})
const pointContext = computed(() => {
  if (!expanded.value) return ''
  const start = pointIndex(props.modelValue, selection.value.start)
  if (!selected.value) return start ? `Caret after code point ${start}` : 'Caret at start'
  const end = pointIndex(props.modelValue, selection.value.end)
  return end === start + 1
    ? `Selected code point ${end}`
    : `Selected code points ${start + 1}–${end}`
})
const count = computed(() => {
  let total = 0
  for (const _ of props.modelValue) total++
  return total
})
const pages = computed(() => Math.max(1, Math.ceil(count.value / pageSize.value)))
const visible = computed(() =>
  expanded.value ? inspectRange(props.modelValue, page.value * pageSize.value, pageSize.value) : [],
)

function syncControl() {
  const field = control.value
  const value = editorText(props.modelValue)
  if (field && !composing && field.value !== value) field.value = value
  resize()
}
function resize() {
  const field = control.value
  if (!field) return
  if (props.inline) {
    field.style.height = ''
    return
  }
  field.style.height = 'auto'
  field.style.height = Math.min(96, Math.max(36, field.scrollHeight)) + 'px'
}
function updatePageSize() {
  const first = page.value * pageSize.value
  pageSize.value = narrow.matches ? 16 : 48
  page.value = Math.floor(first / pageSize.value)
}
let lastWidth = 0
const resizeObserver = new ResizeObserver((entries) => {
  const width = entries[0]?.contentRect.width ?? 0
  if (width !== lastWidth) {
    lastWidth = width
    resize()
  }
})
onMounted(() => {
  syncControl()
  if (control.value) resizeObserver.observe(control.value)
  narrow.addEventListener('change', updatePageSize)
})
onUnmounted(() => {
  narrow.removeEventListener('change', updatePageSize)
  resizeObserver.disconnect()
})
watch(
  () => props.modelValue,
  () => {
    syncControl()
    page.value = Math.min(page.value, pages.value - 1)
  },
)

function readSelection(reveal = true, raw = props.modelValue) {
  const field = control.value
  if (!field || composing) return
  if (
    projection?.raw !== raw ||
    projection.start !== field.selectionStart ||
    projection.end !== field.selectionEnd
  ) {
    projection = undefined
    selection.value = scalarSpan(raw, {
      start: rawOffset(raw, field.selectionStart),
      end: rawOffset(raw, field.selectionEnd),
    })
  }
  if (expanded.value && reveal) {
    const index = pointIndex(raw, selection.value.start)
    page.value = Math.min(pages.value - 1, Math.floor(index / pageSize.value))
  }
}

function remember(event: InputEvent) {
  const field = control.value!
  if (composing) return
  projection = undefined
  before = { start: field.selectionStart, end: field.selectionEnd }
  if (event.inputType.startsWith('history')) before = undefined
}

function nativeInput() {
  const field = control.value!
  if (composing) return
  const draft = applyNativeEdit(props.modelValue, field.value, before, field.selectionStart)
  before = undefined
  emit('update:modelValue', draft)
  resize()
  void nextTick(() => readSelection(true, draft))
}

function startComposition() {
  const field = control.value!
  before = { start: field.selectionStart, end: field.selectionEnd }
  composing = true
  emit('composition', true)
}

function endComposition() {
  composing = false
  nativeInput()
  emit('composition', false)
}

function focusAt(span: Span, focus = true) {
  const field = control.value!
  const raw = props.modelValue
  const start = editorText(raw.slice(0, span.start)).length
  const end = editorText(raw.slice(0, span.end)).length
  if (focus) field.focus({ preventScroll: true })
  field.setSelectionRange(start, end)
  projection = { raw, start, end }
  selection.value = span
}

function apply(span: Span, text: string, focus = true) {
  if (composing) return
  emit(
    'update:modelValue',
    props.modelValue.slice(0, span.start) + text + props.modelValue.slice(span.end),
  )
  const caret = span.start + text.length
  void nextTick(() => {
    const position = scalarSpan(props.modelValue, { start: caret, end: caret })
    focusAt(position, focus)
    readSelection()
  })
}

function paste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData('text/plain')
  if (!text?.includes('\r') || composing) return
  event.preventDefault()
  readSelection()
  apply(selection.value, text)
}

function copySelection(event: ClipboardEvent) {
  if (composing || !event.clipboardData) return
  readSelection()
  if (!selected.value || (!projection && !selected.value.includes('\r'))) return
  event.preventDefault()
  event.clipboardData.setData('text/plain', selected.value)
  if (event.type === 'cut') apply(selection.value, '')
}

function selectPoint(span: Span) {
  focusAt(span, false)
}

function toggle() {
  expanded.value = !expanded.value
  if (expanded.value) readSelection()
}

function copy(value: string) {
  emit('copy', value)
}

defineExpose({ apply, focusAt, context: () => ({ ...selection.value }) })
</script>

<template>
  <div class="composer-argument" :class="{ 'active-argument': active }">
    <label :for="id">{{ label }}</label>
    <textarea
      :id="id"
      ref="control"
      dir="auto"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      autocorrect="off"
      rows="1"
      :placeholder="inline ? label : undefined"
      :wrap="inline ? 'off' : 'soft'"
      :readonly="disabled"
      :enterkeyhint="last ? 'go' : 'next'"
      @keydown="emit('key', $event)"
      @focus="emit('activate')"
      @select="readSelection()"
      @keyup="readSelection()"
      @pointerdown="projection = undefined"
      @pointerup="readSelection()"
      @blur="readSelection()"
      @beforeinput="remember"
      @input="nativeInput"
      @compositionstart="startComposition"
      @compositionend="endComposition"
      @paste="paste"
      @copy="copySelection"
      @cut="copySelection"
    />
    <div v-if="unicode" v-show="active" class="toolbar payload-tools">
      <span class="meta">{{ count }} code {{ count === 1 ? 'point' : 'points' }}</span>
      <button
        type="button"
        class="disclosure"
        :aria-expanded="expanded"
        :aria-controls="id + '-points'"
        @click="toggle"
      >
        <span aria-hidden="true">{{ expanded ? '▾' : '▸' }}</span> Code points
      </button>
      <button
        type="button"
        :disabled="selectedScalar === undefined"
        @click="selectedScalar !== undefined && emit('inspect', selectedScalar)"
      >
        Inspect
      </button>
    </div>
    <div v-show="unicode && active && expanded" :id="id + '-points'" class="point-view">
      <div v-if="pages > 1" class="toolbar pagination">
        <button type="button" :disabled="page === 0" @click="page--">Previous</button>
        <span class="meta" role="status">Page {{ page + 1 }} of {{ pages }}</span>
        <button type="button" :disabled="page + 1 === pages" @click="page++">Next</button>
      </div>
      <div
        v-if="visible.length"
        class="point-grid"
        role="group"
        :aria-label="label + ' code points'"
      >
        <button
          v-for="(point, index) in visible"
          :key="point.start"
          type="button"
          class="point"
          :aria-label="`${page * pageSize + index + 1}. ${point.notation}, ${point.glyph}`"
          :aria-pressed="point.start >= selection.start && point.end <= selection.end"
          @click="selectPoint(point)"
        >
          <bdi>{{ point.glyph }}</bdi
          ><code>{{ point.notation }}</code>
          <span
            v-if="
              caretOffset === point.start ||
              (index === visible.length - 1 && caretOffset === point.end)
            "
            class="point-caret"
            :class="{ 'at-end': caretOffset === point.end }"
            aria-hidden="true"
          ></span>
        </button>
      </div>
      <p v-else class="muted">No code points in this input.</p>
      <div v-if="selected" class="toolbar point-actions">
        <button
          type="button"
          @click="selectPoint({ start: selection.start, end: selection.start })"
        >
          Caret before
        </button>
        <button type="button" @click="selectPoint({ start: selection.end, end: selection.end })">
          Caret after
        </button>
        <button type="button" @click="apply(selection, '')">Delete</button>
        <button type="button" @click="copy(selected)">Copy text</button>
        <button
          type="button"
          @click="
            copy(
              inspect(selected)
                .map((point) => point.notation)
                .join(' '),
            )
          "
        >
          Copy notation
        </button>
      </div>
      <div class="point-context meta" role="status">
        {{ pointContext }}
      </div>
    </div>
  </div>
</template>
