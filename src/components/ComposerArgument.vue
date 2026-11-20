<script setup lang="ts">
import { ChevronRight } from '@lucide/vue'
import { useArgumentEditor } from '../composables/useArgumentEditor'
import type { ArgumentView } from '../lib/workspace'
import { computed, nextTick, ref, useId } from 'vue'
import {
  inspect,
  inspectRange,
  pointIndex,
  readUnicodeEscape,
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
const pointView = ref<HTMLElement>()
const control = ref<HTMLTextAreaElement>()
const mirror = ref<HTMLDivElement>()
const drawnCaret = ref<HTMLSpanElement>()
const {
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
} = useArgumentEditor(props, {
  control,
  mirror,
  drawnCaret,
  update: (text) => emit('update:modelValue', text),
  activate: () => emit('activate'),
  composition: (active) => emit('composition', active),
})
type Inspector = 'points' | 'bytes'
const inspector = ref<Inspector>()
const narrow = matchMedia('(max-width: 600px)')
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
const encoder = new TextEncoder()
const malformedOffset = computed(() => unpairedSurrogate(props.modelValue))
const utf8Length = computed(() =>
  malformedOffset.value === undefined ? encoder.encode(props.modelValue).length : undefined,
)
const points = computed(() =>
  inspector.value === 'points' ||
  (inspector.value === 'bytes' && malformedOffset.value === undefined)
    ? inspect(props.modelValue)
    : [],
)
const byteGroups = computed(() => {
  if (inspector.value !== 'bytes') return []
  let offset = 0
  return points.value.map(({ scalar }) => {
    const bytes = encoder.encode(scalar)
    const group = {
      offset: offset.toString(16).toUpperCase().padStart(4, '0'),
      hex: Array.from(bytes, (byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' '),
    }
    offset += bytes.length
    return group
  })
})

function selectPoint(span: Span) {
  focusAt(span, false)
}

function toggle(view: Inspector) {
  inspector.value = inspector.value === view ? undefined : view
  if (!inspector.value) return
  readSelection()
  void nextTick(() => {
    const panel = pointView.value
    const list = panel?.closest<HTMLElement>('.composer-arguments')
    if (!panel || !list?.clientHeight || list.scrollHeight <= list.clientHeight) return
    if (!narrow.matches && !list.closest('.short-viewport')) return
    // Reveal the start of the inspector without moving the transcript or the command bar.
    const firstPoint = panel.querySelector('.point')
    const preview = Math.min(
      firstPoint
        ? firstPoint.getBoundingClientRect().bottom - panel.getBoundingClientRect().top
        : panel.offsetHeight,
      list.clientHeight,
    )
    const hidden = panel.getBoundingClientRect().top + preview - list.getBoundingClientRect().bottom
    if (hidden > 0) list.scrollTop += hidden
  })
}

function copy(value: string) {
  emit('copy', value)
}

function restoreView(view: ArgumentView) {
  inspector.value = view.expanded === true ? (view.bytes ? 'bytes' : 'points') : undefined
}

defineExpose({
  apply,
  focusAt,
  captureSelection,
  context: () => ({ ...selection.value }),
  saveView: () => ({
    expanded: inspector.value !== undefined,
    bytes: inspector.value === 'bytes' || undefined,
  }),
  restoreView,
})
</script>

<template>
  <div class="composer-argument" :class="{ 'active-argument': active, 'inline-argument': inline }">
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
        @pointerdown="clearProjection"
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
        <ChevronRight class="disclosure-icon" aria-hidden="true" /> Code points
      </button>
      <button
        type="button"
        class="disclosure"
        :aria-expanded="inspector === 'bytes'"
        :aria-controls="id + '-points'"
        @click="toggle('bytes')"
      >
        <ChevronRight class="disclosure-icon" aria-hidden="true" /> UTF-8 bytes
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
      ref="pointView"
      class="point-view"
      role="region"
      :aria-label="label + ' Unicode inspector'"
    >
      <p v-if="inspector === 'bytes' && malformedOffset !== undefined" class="muted">
        Unpaired surrogate at UTF-16 offset {{ malformedOffset }}.
      </p>
      <template v-else>
        <div
          v-if="points.length"
          class="point-grid"
          :class="{ 'argument-byte-grid': inspector === 'bytes' }"
          role="group"
          :aria-label="label + (inspector === 'bytes' ? ' UTF-8 bytes' : ' code points')"
        >
          <button
            v-for="(point, index) in points"
            :key="point.start"
            type="button"
            class="point"
            :aria-label="
              byteGroups[index]
                ? `Byte offset 0x${byteGroups[index].offset}, ${byteGroups[index].hex}, ${point.notation}`
                : `${index + 1}. ${point.notation}, ${point.glyph}`
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
                (index === points.length - 1 && caretOffset === point.end)
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

<style scoped>
.disclosure[aria-expanded='true'] .disclosure-icon {
  rotate: 90deg;
}
.disclosure {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding-inline: var(--space-1);
  border-color: transparent;
}
.point-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(69px, 1fr));
  gap: 4px;
}
.argument-byte-grid {
  display: flex;
  flex-wrap: wrap;
}
.point {
  position: relative;
  display: inline-grid;
  justify-items: center;
  align-content: center;
  gap: 1px;
  min-height: 44px;
  min-width: 64px;
  padding: 2px 4px;
  border-color: transparent;
  background: transparent;
  line-height: 1.3;
}
.point-caret {
  position: absolute;
  inset-block: 6px;
  inset-inline-start: -4px;
  width: 2px;
  border-radius: 1px;
  background: var(--accent);
  pointer-events: none;
}
.point-caret.at-end {
  inset-inline-start: auto;
  inset-inline-end: -4px;
}
.point bdi {
  font-size: 13px;
}
.point code {
  font-size: 11px;
  color: var(--muted);
}
.argument-byte-grid .point {
  min-width: 69px;
}
.argument-byte-values {
  white-space: nowrap;
}
.point-actions {
  margin-top: 6px;
}
.point-context {
  margin-top: 4px;
}
.composer-argument button {
  border-color: transparent;
  background: transparent;
  font-size: 12px;
}
.composer-argument button:disabled {
  color: var(--muted);
}
.composer-argument {
  display: grid;
  grid-template-columns: minmax(9ch, 19ch) minmax(0, 1fr);
  align-items: start;
  column-gap: 8px;
}
.composer-argument > label {
  align-self: center;
  color: var(--muted);
  font-size: 12px;
  font-weight: 400;
  overflow-wrap: anywhere;
  cursor: text;
}
.composer-argument.active-argument > label {
  color: var(--accent);
}
.argument-editor {
  position: relative;
  min-width: 0;
  background: var(--inset);
  box-shadow: inset 0 -1px var(--control);
}
.argument-editor:focus-within {
  box-shadow: inset 0 -1px var(--accent);
}
.argument-editor :is(textarea, .argument-mirror) {
  padding: 5px 6px var(--space-1);
  font: inherit;
  line-height: 1.5;
  tab-size: 8;
}
.argument-editor textarea {
  width: 100%;
  display: block;
  min-height: var(--control-height);
  max-height: 76px;
  margin: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  resize: none;
  caret-color: var(--accent);
}
.argument-editor textarea:focus {
  outline: none;
}
.argument-overlay {
  position: absolute;
  inset: 0;
  overflow: clip;
  pointer-events: none;
}
.argument-mirror {
  position: absolute;
  inset: 0 auto auto 0;
  visibility: hidden;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  unicode-bidi: plaintext;
}
.argument-caret {
  position: absolute;
  width: 2px;
  background: var(--accent);
}
.composer-argument .payload-tools,
.composer-argument .point-view {
  grid-column: 1 / -1;
  margin: 0 0 2px;
}
.composer-argument .payload-tools {
  justify-content: flex-start;
  gap: 0 var(--space-1);
}
.argument-lengths {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-2);
  font-size: 11px;
}
.composer-argument .point-view {
  padding: 4px 6px;
  border-top: 1px solid var(--line);
  background: var(--surface);
}
.composer-argument .payload-tools button {
  min-height: 28px;
  padding: 1px 4px;
}
@media (max-width: 600px), (pointer: coarse) {
  .composer-argument {
    grid-template-columns: minmax(9ch, 15ch) minmax(0, 1fr);
    column-gap: 6px;
  }
  .argument-editor :is(textarea, .argument-mirror) {
    font-size: 16px;
    padding-top: 9px;
  }
  .argument-editor textarea {
    min-height: var(--touch-height);
    max-height: 64px;
  }
  .composer-argument .payload-tools button {
    min-height: 34px;
  }
  .argument-lengths {
    flex-basis: 100%;
  }
}
.composer-argument.inline-argument {
  display: contents;
}
.composer-argument.inline-argument > label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.inline-argument .argument-editor {
  grid-column: 3;
  grid-row: 1;
}
.inline-argument .argument-editor textarea {
  height: 36px;
  max-height: 36px;
  overflow: auto;
  scrollbar-width: none;
}
.inline-argument .argument-mirror {
  white-space: pre;
}
.composer-argument textarea::placeholder {
  color: var(--muted);
  opacity: 1;
}
.inline-argument .payload-tools {
  grid-column: 1 / -1;
  grid-row: 3;
}
.inline-argument .point-view {
  grid-column: 1 / -1;
  grid-row: 4;
  max-height: min(45dvh, 300px);
  overflow: auto;
  overscroll-behavior: contain;
}
.short-viewport .inline-argument .point-view {
  max-height: calc(var(--app-height, 100dvh) * 0.22);
}
.short-viewport.session-expanded .inline-argument .point-view {
  max-height: calc(var(--app-height, 100dvh) * 0.15);
}
@media (max-width: 600px) {
  .inline-argument .argument-editor {
    grid-column: 1 / -1;
    grid-row: 3;
    margin-block-start: var(--compact-inset);
  }
  .inline-argument .payload-tools {
    grid-row: 4;
  }
  .inline-argument .point-view {
    grid-row: 5;
  }
  .short-viewport .inline-argument .point-view {
    max-height: calc(var(--app-height, 100dvh) * 0.16);
  }
  .short-viewport.session-expanded .inline-argument .point-view {
    max-height: calc(var(--app-height, 100dvh) * 0.12);
  }
}
@media (max-width: 600px), (pointer: coarse) {
  .composer-argument.inline-argument textarea {
    height: 44px;
    max-height: 44px;
  }
}
@media (max-width: 830px) {
  .composer-argument :is(.payload-tools, .point-view) {
    margin: 0;
  }
  .argument-lengths {
    line-height: var(--compact-leading);
  }
  .point-actions button {
    min-height: var(--compact-control);
    padding-block: var(--compact-inset);
    font: 12px / var(--compact-leading) var(--sans);
  }
  .composer-argument .payload-tools button {
    min-height: var(--control-height);
    font: 12px / var(--compact-leading) var(--sans);
  }
  .composer-argument .point-view {
    display: grid;
    gap: var(--compact-tight);
    padding: var(--compact-tight) var(--compact-gap);
    background: transparent;
  }
  .composer-argument :is(.point-actions, .point-context) {
    margin: 0;
  }
  .composer-argument .point {
    min-height: var(--compact-control);
    padding-block: var(--compact-tight);
  }
}

@media (max-width: 600px) {
  .composer-argument:not(.inline-argument) {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--compact-tight);
  }
  .composer-argument > label {
    font-size: var(--compact-meta);
    line-height: var(--compact-leading);
  }
  .argument-editor :is(textarea, .argument-mirror) {
    line-height: 1.35;
    padding: var(--compact-inset) var(--space-2);
  }
  .composer-argument:not(.inline-argument) .argument-editor textarea {
    min-height: 36px;
    max-height: 50px;
    overflow: auto;
  }
  .composer-argument.inline-argument textarea {
    min-height: 36px;
    height: 36px;
    max-height: 36px;
  }
  .inline-argument .argument-editor :is(textarea, .argument-mirror) {
    padding-block: 7px;
  }
}
@media (min-width: 831px) {
  .short-viewport .composer-argument:not(.inline-argument) .argument-editor textarea {
    max-height: 52px;
  }
  .short-viewport
    .composer-argument:not(.inline-argument)
    .argument-editor
    :is(textarea, .argument-mirror) {
    line-height: 1.35;
    padding-block: var(--space-1);
  }
}
</style>
