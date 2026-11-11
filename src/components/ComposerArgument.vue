<script setup lang="ts">
import type { ArgumentView } from '../lib/workspace'
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch, watchPostEffect } from 'vue'
import {
  applyNativeEdit,
  editorText,
  inspect,
  inspectRange,
  pointIndex,
  rawOffset,
  readUnicodeEscape,
  scalarSpan,
  unpairedSurrogate,
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
const mirror = ref<HTMLDivElement>()
const drawnCaret = ref<HTMLSpanElement>()
const focused = ref(false)
type Inspector = 'points' | 'bytes'
const inspector = ref<Inspector>()
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
  if (!inspector.value) return ''
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
const encoder = new TextEncoder()
const malformedOffset = computed(() => unpairedSurrogate(props.modelValue))
const utf8Length = computed(() =>
  malformedOffset.value === undefined ? encoder.encode(props.modelValue).length : undefined,
)
const mirroredText = computed(() => {
  const text = editorText(props.modelValue)
  // Give an empty final line a measurable text position.
  return !text || text.endsWith('\n') ? text + '\u200b' : text
})
const visible = computed(() =>
  inspector.value
    ? inspectRange(props.modelValue, page.value * pageSize.value, pageSize.value)
    : [],
)
const byteGroups = computed(() => {
  if (inspector.value !== 'bytes' || malformedOffset.value !== undefined || !visible.value.length)
    return []
  let offset = encoder.encode(props.modelValue.slice(0, visible.value[0].start)).length
  return visible.value.map(({ scalar }) => {
    const bytes = encoder.encode(scalar)
    const group = {
      offset: offset.toString(16).toUpperCase().padStart(4, '0'),
      hex: Array.from(bytes, (byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' '),
    }
    offset += bytes.length
    return group
  })
})

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

function positionCaret(reveal = false) {
  const field = control.value
  const layout = mirror.value
  const caret = drawnCaret.value
  const text = layout?.firstChild
  if (!field || !layout || !caret || !text) return
  layout.style.width = field.clientWidth + 'px'
  layout.style.direction = getComputedStyle(field).direction
  const range = document.createRange()
  range.setStart(text, editorText(props.modelValue.slice(0, selection.value.start)).length)
  range.collapse(true)
  const rect = range.getBoundingClientRect()
  const origin = layout.getBoundingClientRect()
  const left = rect.left - origin.left
  const top = rect.top - origin.top
  if (reveal) {
    const x = left - field.scrollLeft
    const y = top - field.scrollTop
    if (x < 1) field.scrollLeft += x - 1
    else if (x > field.clientWidth - 2) field.scrollLeft += x - field.clientWidth + 2
    if (y < 0) field.scrollTop += y
    else if (y + rect.height > field.clientHeight)
      field.scrollTop += y + rect.height - field.clientHeight
  }
  const x = left - field.scrollLeft
  const y = top - field.scrollTop
  caret.hidden =
    !rect.height ||
    x < 0 ||
    x > field.clientWidth ||
    y + rect.height <= 0 ||
    y >= field.clientHeight
  caret.style.left = Math.min(x, field.clientWidth - 2) + field.clientLeft + 'px'
  caret.style.top = y + field.clientTop + 'px'
  caret.style.height = rect.height + 'px'
}
watchPostEffect(() => positionCaret())

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
  positionCaret()
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
  if (inspector.value && reveal) {
    const index = pointIndex(raw, selection.value.start)
    page.value = Math.min(pages.value - 1, Math.floor(index / pageSize.value))
  }
}

function onFocus() {
  focused.value = true
  emit('activate')
}

function onBlur() {
  readSelection()
  focused.value = false
  void nextTick(() => positionCaret(true))
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
  if (!focus) void nextTick(() => positionCaret(true))
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

function toggle(view: Inspector) {
  inspector.value = inspector.value === view ? undefined : view
  if (inspector.value) readSelection()
}

function copy(value: string) {
  emit('copy', value)
}

function restoreView(view: ArgumentView) {
  inspector.value = view.expanded === true ? (view.bytes ? 'bytes' : 'points') : undefined
  page.value = Number.isSafeInteger(view.page)
    ? Math.max(0, Math.min(view.page, pages.value - 1))
    : 0
}

defineExpose({
  apply,
  focusAt,
  captureSelection() {
    if (document.activeElement === control.value) readSelection(false)
  },
  context: () => ({ ...selection.value }),
  saveView: (): ArgumentView => ({
    expanded: inspector.value !== undefined,
    page: page.value,
    bytes: inspector.value === 'bytes' || undefined,
  }),
  restoreView,
})
</script>

<template>
  <div class="composer-argument" :class="{ 'active-argument': active }">
    <label :for="id">{{ label }}</label>
    <div class="argument-editor">
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
        @focus="onFocus"
        @select="readSelection()"
        @keyup="readSelection()"
        @pointerdown="projection = undefined"
        @pointerup="readSelection()"
        @blur="onBlur"
        @scroll="positionCaret()"
        @beforeinput="remember"
        @input="nativeInput"
        @compositionstart="startComposition"
        @compositionend="endComposition"
        @paste="paste"
        @copy="copySelection"
        @cut="copySelection"
      />
      <div v-if="active && !focused" class="argument-overlay" aria-hidden="true">
        <div ref="mirror" class="argument-mirror" v-text="mirroredText"></div>
        <span ref="drawnCaret" class="argument-caret"></span>
      </div>
    </div>
    <div v-show="active" class="toolbar payload-tools">
      <span class="meta argument-lengths">
        <span v-if="unicode">{{ count }} code {{ count === 1 ? 'point' : 'points' }}</span>
        <span v-if="utf8Length !== undefined">UTF-8 {{ utf8Length }} B</span>
        <span v-else title="Unpaired surrogate">UTF-8 unavailable</span>
        <span>UTF-16 {{ modelValue.length }} units</span>
      </span>
      <button
        v-if="unicode"
        type="button"
        class="disclosure"
        :aria-expanded="inspector === 'points'"
        :aria-controls="id + '-points'"
        @click="toggle('points')"
      >
        <span aria-hidden="true">{{ inspector === 'points' ? '▾' : '▸' }}</span> Code points
      </button>
      <button
        type="button"
        class="disclosure"
        :aria-expanded="inspector === 'bytes'"
        :aria-controls="id + '-points'"
        @click="toggle('bytes')"
      >
        <span aria-hidden="true">{{ inspector === 'bytes' ? '▾' : '▸' }}</span> UTF-8 bytes
      </button>
      <button
        v-if="unicode"
        type="button"
        :disabled="selectedScalar === undefined"
        @click="selectedScalar !== undefined && emit('inspect', selectedScalar)"
      >
        Inspect
      </button>
    </div>
    <div
      v-show="active && inspector"
      :id="id + '-points'"
      class="point-view"
      role="region"
      :aria-label="label + ' Unicode inspector'"
    >
      <p v-if="inspector === 'bytes' && malformedOffset !== undefined" class="muted">
        Unpaired surrogate at UTF-16 offset {{ malformedOffset }}.
      </p>
      <template v-else>
        <div v-if="pages > 1" class="toolbar pagination">
          <button type="button" :disabled="page === 0" @click="page--">Previous</button>
          <span class="meta" role="status">Page {{ page + 1 }} of {{ pages }}</span>
          <button type="button" :disabled="page + 1 === pages" @click="page++">Next</button>
        </div>
        <div
          v-if="visible.length"
          class="point-grid"
          :class="{ 'argument-byte-grid': inspector === 'bytes' }"
          role="group"
          :aria-label="label + (inspector === 'bytes' ? ' UTF-8 bytes' : ' code points')"
        >
          <button
            v-for="(point, index) in visible"
            :key="point.start"
            type="button"
            class="point"
            :aria-label="
              byteGroups[index]
                ? `Byte offset 0x${byteGroups[index].offset}, ${byteGroups[index].hex}, ${point.notation}`
                : `${page * pageSize + index + 1}. ${point.notation}, ${point.glyph}`
            "
            :title="byteGroups[index] ? `Byte offset 0x${byteGroups[index].offset}` : undefined"
            :aria-pressed="point.start >= selection.start && point.end <= selection.end"
            @click="selectPoint(point)"
          >
            <bdi>{{ point.glyph }}</bdi>
            <code :class="{ 'argument-byte-values': byteGroups[index] }">
              {{ byteGroups[index]?.hex ?? point.notation }}
            </code>
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
        <p v-else class="muted">
          {{
            inspector === 'bytes'
              ? 'No UTF-8 bytes in this input.'
              : 'No code points in this input.'
          }}
        </p>
      </template>
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
