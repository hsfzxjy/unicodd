import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
  watchPostEffect,
  type Ref,
} from 'vue'
import { applyNativeEdit, editorText, rawOffset, scalarSpan, type Span } from '../lib/unicode'

export function useArgumentEditor(
  props: { readonly modelValue: string; readonly inline: boolean },
  {
    control,
    mirror,
    drawnCaret,
    update,
    activate,
    composition,
  }: {
    control: Ref<HTMLTextAreaElement | undefined>
    mirror: Ref<HTMLDivElement | undefined>
    drawnCaret: Ref<HTMLSpanElement | undefined>
    update: (text: string) => void
    activate: () => void
    composition: (active: boolean) => void
  },
) {
  const focused = ref(false)
  const selection = ref<Span>({ start: 0, end: 0 })
  let composing = false
  let before: Span | undefined
  let projection: { raw: string; start: number; end: number } | undefined
  const selected = computed(() =>
    props.modelValue.slice(selection.value.start, selection.value.end),
  )
  const mirroredText = computed(() => {
    const text = editorText(props.modelValue)
    // Give an empty final line a measurable text position.
    return !text || text.endsWith('\n') ? text + '\u200b' : text
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
  })
  onUnmounted(() => {
    resizeObserver.disconnect()
  })
  watch(() => props.modelValue, syncControl)

  function readSelection(raw = props.modelValue) {
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
  }

  function onFocus() {
    focused.value = true
    activate()
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
    update(draft)
    resize()
    void nextTick(() => readSelection(draft))
  }

  function startComposition() {
    const field = control.value!
    before = { start: field.selectionStart, end: field.selectionEnd }
    composing = true
    composition(true)
  }

  function endComposition() {
    composing = false
    nativeInput()
    composition(false)
  }

  function focusAt(span: Span, focus = true) {
    const field = control.value!
    const raw = props.modelValue
    const start = editorText(raw.slice(0, span.start)).length
    const end = editorText(raw.slice(0, span.end)).length
    if (focus) {
      field.focus({ preventScroll: true })
      const list = field.closest<HTMLElement>('.composer-arguments')
      if (list && list.clientHeight && list.scrollHeight > list.clientHeight) {
        const bounds = list.getBoundingClientRect()
        const editor = field.getBoundingClientRect()
        const label = field.closest('.composer-argument')?.getBoundingClientRect()
        const top = label?.top ?? editor.top
        if (top < bounds.top) list.scrollTop -= bounds.top - top
        else if (editor.bottom > bounds.bottom) list.scrollTop += editor.bottom - bounds.bottom
      }
    }
    field.setSelectionRange(start, end)
    projection = { raw, start, end }
    selection.value = span
    if (!focus) void nextTick(() => positionCaret(true))
  }

  function apply(span: Span, text: string, focus = true) {
    if (composing) return
    update(props.modelValue.slice(0, span.start) + text + props.modelValue.slice(span.end))
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

  function captureSelection() {
    if (document.activeElement === control.value) readSelection()
  }

  function clearProjection() {
    projection = undefined
  }

  return {
    selected,
    selection,
    focused,
    mirroredText,
    apply,
    focusAt,
    captureSelection,
    readSelection,
    positionCaret,
    onFocus,
    onBlur,
    remember,
    nativeInput,
    startComposition,
    endComposition,
    clearProjection,
    paste,
    copySelection,
  }
}
