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

export function revealArgument(
  field: HTMLTextAreaElement | HTMLSelectElement,
  inline: boolean,
  caret?: { top: number; height: number },
) {
  const list = field.closest<HTMLElement>('.composer-arguments')
  if (!list?.clientHeight || list.scrollHeight <= list.clientHeight) return
  const bounds = list.getBoundingClientRect()
  const editor = field.getBoundingClientRect()
  const label = inline
    ? undefined
    : field.closest('.composer-argument')?.querySelector('label')?.getBoundingClientRect()
  const top = Math.min(editor.top, label?.top ?? editor.top)
  const caretTop = editor.top + (caret?.top ?? 0) - field.scrollTop + field.clientTop
  const targetTop =
    editor.bottom - top <= list.clientHeight
      ? top
      : editor.height <= list.clientHeight || !caret
        ? editor.top
        : caretTop
  const targetBottom =
    editor.height <= list.clientHeight || !caret ? editor.bottom : caretTop + caret.height
  if (targetTop < bounds.top) list.scrollTop += targetTop - bounds.top
  else if (targetBottom > bounds.top + list.clientHeight)
    list.scrollTop += targetBottom - (bounds.top + list.clientHeight)
}

export function useArgumentEditor(
  props: { readonly modelValue: string; readonly inline: boolean },
  {
    control,
    mirror,
    drawnCaret,
    height,
    update,
    activate,
    composition,
  }: {
    control: Ref<HTMLTextAreaElement | undefined>
    mirror: Ref<HTMLDivElement | undefined>
    drawnCaret: Ref<HTMLSpanElement | undefined>
    height: Ref<number | undefined>
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
    if (height.value !== undefined) {
      field.style.height = height.value + 'px'
      return
    }
    if (props.inline) {
      field.style.height = ''
      return
    }
    field.style.height = 'auto'
    field.style.height = Math.min(96, Math.max(36, field.scrollHeight)) + 'px'
  }

  function caretRect(field: HTMLTextAreaElement, start: number, value: string) {
    const layout = mirror.value
    if (!layout) return
    const measurable = !value || value.endsWith('\n') ? value + '\u200b' : value
    if (layout.textContent !== measurable) layout.textContent = measurable
    layout.style.width = field.clientWidth + 'px'
    layout.style.direction = getComputedStyle(field).direction
    const range = document.createRange()
    range.setStart(layout.firstChild!, start)
    range.collapse(true)
    const rect = range.getBoundingClientRect()
    const origin = layout.getBoundingClientRect()
    return { left: rect.left - origin.left, top: rect.top - origin.top, height: rect.height }
  }

  function scrollCaret(
    field: HTMLTextAreaElement,
    { left, top, height }: NonNullable<ReturnType<typeof caretRect>>,
  ) {
    const x = left - field.scrollLeft
    const y = top - field.scrollTop
    if (x < 1) field.scrollLeft += x - 1
    else if (x > field.clientWidth - 2) field.scrollLeft += x - field.clientWidth + 2
    if (y < 0) field.scrollTop += y
    else if (y + height > field.clientHeight) field.scrollTop += y + height - field.clientHeight
  }

  function positionCaret(reveal = false) {
    const field = control.value
    const caret = drawnCaret.value
    if (!field || !caret || focused.value) return
    const value = editorText(props.modelValue)
    const rect = caretRect(
      field,
      editorText(props.modelValue.slice(0, selection.value.start)).length,
      value,
    )
    if (!rect) return
    if (reveal) scrollCaret(field, rect)
    const { left, top } = rect
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

  function revealEditor() {
    const field = control.value
    if (!field || document.activeElement !== field) return
    const start =
      field.selectionDirection === 'backward' ? field.selectionStart : field.selectionEnd
    const caret = caretRect(field, start, field.value)
    if (caret) scrollCaret(field, caret)
    revealArgument(field, props.inline, caret)
  }

  let lastWidth = 0
  let editorFrame = 0
  const resizeObserver = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 0
    cancelAnimationFrame(editorFrame)
    editorFrame = requestAnimationFrame(() => {
      if (width !== lastWidth) {
        lastWidth = width
        resize()
      }
      positionCaret()
      revealEditor()
    })
  })
  onMounted(() => {
    syncControl()
    if (control.value) resizeObserver.observe(control.value)
  })
  onUnmounted(() => {
    resizeObserver.disconnect()
    cancelAnimationFrame(editorFrame)
  })
  watch(() => props.modelValue, syncControl)
  watch(height, resize)

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
    void nextTick(revealEditor)
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
    if (focus) field.focus({ preventScroll: true })
    field.setSelectionRange(start, end)
    projection = { raw, start, end }
    selection.value = span
    void nextTick(focus ? revealEditor : () => positionCaret(true))
  }

  function apply(span: Span, text: string, focus = true) {
    if (composing) return
    const raw = props.modelValue
    const draft = raw.slice(0, span.start) + text + raw.slice(span.end)
    update(draft)
    const caret = span.start + text.length
    void nextTick(() => {
      const position = scalarSpan(props.modelValue, { start: caret, end: caret })
      focusAt(position, focus)
      readSelection()
    })
    if (draft !== raw) return { start: span.start, end: caret }
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
    revealEditor,
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
