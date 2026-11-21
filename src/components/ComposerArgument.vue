<script setup lang="ts">
import { ref, useId } from 'vue'
import ArgumentInspector from './ArgumentInspector.vue'
import { useArgumentEditor } from '../composables/useArgumentEditor'
import { useArgumentResize } from '../composables/useArgumentResize'
import type { ArgumentInspector as InspectorType } from '../lib/argument-inspectors'
import type { ArgumentView } from '../lib/workspace'

const props = defineProps<{
  label: string
  modelValue: string
  sizeKey: string
  inline: boolean
  active: boolean
  inspectors: readonly InspectorType[]
  literal: boolean
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
const inspector = ref<InstanceType<typeof ArgumentInspector>>()
const control = ref<HTMLTextAreaElement>()
const mirror = ref<HTMLDivElement>()
const drawnCaret = ref<HTMLSpanElement>()
const resize = useArgumentResize(props.sizeKey, control)
const { height } = resize
const {
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
} = useArgumentEditor(props, {
  control,
  mirror,
  drawnCaret,
  height,
  update: (text) => emit('update:modelValue', text),
  activate: () => emit('activate'),
  composition: (active) => emit('composition', active),
})

defineExpose({
  apply,
  focusAt,
  revealEditor,
  captureSelection,
  context: () => ({ ...selection.value }),
  saveView: () => inspector.value?.saveView(),
  restoreView: (view: ArgumentView) => inspector.value?.restoreView(view),
})
</script>

<template>
  <div class="composer-argument" :class="{ 'active-argument': active, 'inline-argument': inline }">
    <label :for="id">{{ label }}</label>
    <div class="argument-editor" :class="{ 'resized-editor': height !== undefined }">
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
        :wrap="inline && height === undefined ? 'off' : 'soft'"
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
      <button
        type="button"
        class="resize-handle"
        :aria-label="'Resize ' + label"
        title="Drag up or use the arrow keys to resize"
        @pointerdown="resize.start"
        @pointermove="resize.move"
        @pointerup="resize.end"
        @lostpointercapture="resize.end"
        @keydown="resize.keydown"
      ></button>
      <div v-if="active" class="argument-overlay" aria-hidden="true">
        <div ref="mirror" class="argument-mirror" v-text="mirroredText"></div>
        <span v-if="!focused" ref="drawnCaret" class="argument-caret"></span>
      </div>
    </div>
    <ArgumentInspector
      v-if="inspectors.length"
      v-show="active"
      ref="inspector"
      :label="label"
      :source="modelValue"
      :selection="selection"
      :types="inspectors"
      :literal="literal"
      :disabled="disabled"
      @select="focusAt($event, false)"
      @remove="apply($event, '')"
      @inspect="emit('inspect', $event)"
      @copy="emit('copy', $event)"
    />
  </div>
</template>

<style scoped>
.composer-argument {
  display: grid;
  grid-template-columns: minmax(9ch, 19ch) minmax(0, 1fr);
  align-items: start;
  column-gap: 8px;
}
.composer-argument > label,
.composer-argument textarea::placeholder {
  font-family: var(--sans);
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
  font-size: var(--compact-text, 13px);
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
.resize-handle {
  position: absolute;
  inset-block-start: -4px;
  inset-inline-start: 50%;
  translate: -50%;
  display: grid;
  place-items: center;
  width: 44px;
  height: 12px;
  min-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: ns-resize;
  touch-action: none;
}
.resize-handle::after {
  content: '';
  width: 24px;
  height: 3px;
  border-radius: 2px;
  background: var(--control);
}
.resize-handle:hover::after,
.resize-handle:focus-visible::after {
  background: var(--accent);
}
.argument-inspector {
  grid-column: 1 / -1;
}
@media (max-width: 600px), (pointer: coarse) {
  .composer-argument {
    grid-template-columns: minmax(9ch, 15ch) minmax(0, 1fr);
    column-gap: 6px;
  }
  .argument-editor :is(textarea, .argument-mirror) {
    padding-top: 9px;
  }
  .argument-editor textarea {
    min-height: var(--touch-height);
    max-height: 64px;
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
.inline-argument .argument-inspector {
  grid-row: 3;
  --inspector-scroll-height: min(45dvh, 300px);
}
.short-viewport .argument-inspector {
  --inspector-scroll-height: max(44px, calc(var(--app-height, 100dvh) * 0.17));
}
.short-viewport.session-expanded .argument-inspector {
  --inspector-scroll-height: max(44px, calc(var(--app-height, 100dvh) * 0.12));
}
@media (max-width: 600px) {
  .composer-argument:not(.inline-argument) {
    --argument-label-space: 18px;
  }
  .inline-argument .argument-editor {
    grid-column: 1 / -1;
    grid-row: 3;
    margin-block-start: var(--compact-inset);
  }
  .inline-argument .argument-inspector {
    grid-row: 4;
  }
}
@media (max-width: 600px), (pointer: coarse) {
  .composer-argument.inline-argument textarea {
    height: 44px;
    max-height: 44px;
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
  .short-viewport
    .composer-argument:not(.inline-argument)
    .argument-editor:not(.resized-editor)
    textarea {
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
.composer-argument .argument-editor.resized-editor textarea {
  max-height: min(
    220px,
    calc(var(--app-height, 100dvh) * 0.28),
    calc(var(--argument-body-limit, 220px) - var(--argument-label-space, 0px))
  );
  scrollbar-width: thin;
}
.short-viewport .inline-argument .resized-editor textarea {
  max-height: min(
    220px,
    calc(var(--app-height, 100dvh) * 0.28),
    var(--inline-editor-budget, 220px)
  );
}
.short-viewport .inline-argument .argument-inspector :deep(.point-scroll) {
  max-height: min(var(--inspector-scroll-height), var(--inline-inspector-budget, 300px));
}
.argument-editor.resized-editor .argument-mirror {
  white-space: pre-wrap;
}
</style>
