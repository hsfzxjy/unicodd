<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import {
  applyNativeEdit,
  copyText,
  editorText,
  inspect,
  inspectRange,
  pointIndex,
  rawOffset,
  scalarSpan,
  type Span,
} from '../lib/unicode'

const props = defineProps<{ label: string; modelValue: string }>()
const emit = defineEmits<{
  'update:modelValue': [string]
  workbench: [Span, string | undefined]
  active: []
  composition: [boolean]
}>()
const id = useId()
const control = ref<HTMLTextAreaElement>()
const expanded = ref(false)
const selection = ref<Span>({ start: 0, end: 0 })
const page = ref(0)
const feedback = ref('')
const narrow = matchMedia('(max-width: 600px)')
const pageSize = ref(narrow.matches ? 16 : 48)
let composing = false
let before: Span | undefined
let projection: { raw: string; start: number; end: number } | undefined
const selected = computed(() => props.modelValue.slice(selection.value.start, selection.value.end))
const caretOffset = computed(() =>
  selection.value.start === selection.value.end ? selection.value.start : undefined,
)
const firstPoint = computed(() => inspectRange(selected.value, 0, 1)[0])
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
}
function updatePageSize() {
  const first = page.value * pageSize.value
  pageSize.value = narrow.matches ? 16 : 48
  page.value = Math.floor(first / pageSize.value)
}
onMounted(() => {
  syncControl()
  narrow.addEventListener('change', updatePageSize)
})
onUnmounted(() => narrow.removeEventListener('change', updatePageSize))
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
  if (focus) field.focus()
  field.setSelectionRange(start, end)
  projection = { raw, start, end }
  selection.value = span
  if (focus) field.scrollIntoView({ block: 'nearest' })
}

function apply(span: Span, text: string) {
  if (composing) return
  emit(
    'update:modelValue',
    props.modelValue.slice(0, span.start) + text + props.modelValue.slice(span.end),
  )
  const caret = span.start + text.length
  void nextTick(() => {
    const position = scalarSpan(props.modelValue, { start: caret, end: caret })
    focusAt(position)
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

function openWorkbench() {
  if (composing) return
  emit(
    'workbench',
    { ...selection.value },
    firstPoint.value?.valid ? firstPoint.value.scalar : undefined,
  )
}

async function copy(value: string) {
  try {
    await copyText(value)
    feedback.value = 'Copied.'
  } catch {
    feedback.value = 'Clipboard unavailable.'
  }
}

defineExpose({ apply, focusAt, context: () => ({ ...selection.value }) })
</script>

<template>
  <div class="payload">
    <div class="field-head">
      <label :for="id">{{ label }}</label>
      <span class="meta">{{ count }} code {{ count === 1 ? 'point' : 'points' }}</span>
    </div>
    <textarea
      :id="id"
      ref="control"
      dir="auto"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      autocorrect="off"
      rows="3"
      @focus="emit('active')"
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
    <div class="toolbar payload-tools">
      <button
        type="button"
        class="disclosure"
        :aria-expanded="expanded"
        :aria-controls="id + '-points'"
        @click="toggle"
      >
        <span aria-hidden="true">{{ expanded ? '▾' : '▸' }}</span> Code points
      </button>
      <button type="button" aria-haspopup="dialog" @click="openWorkbench">Open Workbench</button>
    </div>
    <div v-show="expanded" :id="id + '-points'" class="point-view">
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
        <span v-if="feedback"> · {{ feedback }}</span>
      </div>
    </div>
  </div>
</template>
