<script setup lang="ts">
import { ChevronRight, Search, Sigma, TextCursor, TextCursorInput } from '@lucide/vue'
import { computed, nextTick, ref, useId } from 'vue'
import {
  argumentInspectors,
  encodeArgument,
  inspectArgument,
  inspectorSelection,
  type ArgumentInspector,
} from '../lib/argument-inspectors'
import type { Span } from '../lib/unicode'
import type { ArgumentView } from '../lib/workspace'

const props = defineProps<{
  label: string
  source: string
  selection: Span
  types: readonly ArgumentInspector[]
  literal: boolean
  disabled: boolean
}>()
const emit = defineEmits<{
  select: [Span]
  remove: [Span]
  inspect: [string]
  copy: [string]
}>()
const id = useId()
const panel = ref<HTMLElement>()
const scroll = ref<HTMLElement>()
const chosen = ref<ArgumentInspector>()
const expanded = ref(false)
const kind = computed(() =>
  chosen.value && props.types.includes(chosen.value) ? chosen.value : props.types[0],
)
const label = computed(() => argumentInspectors[kind.value].label)
const projection = computed(() => inspectArgument(props.source, props.literal))
const view = computed(() => encodeArgument(kind.value, projection.value))
const position = computed(() => inspectorSelection(view.value, props.selection))
const selected = computed(() => position.value.selected)
const selectedScalar = computed(() => {
  const points = selected.value?.points
  if (points?.length === 1 && points[0].valid) return points[0].scalar
})

function showPreview() {
  void nextTick(() => {
    const region = panel.value
    const list = region?.closest<HTMLElement>('.composer-arguments')
    if (!region || !list?.clientHeight || list.scrollHeight <= list.clientHeight) return
    const first = region.querySelector('.point') ?? region
    const hidden = first.getBoundingClientRect().bottom - list.getBoundingClientRect().bottom + 2
    if (hidden > 0) list.scrollTop += hidden
  })
}

function toggle() {
  expanded.value = !expanded.value
  if (expanded.value) showPreview()
}

function choose(event: Event) {
  chosen.value = (event.target as HTMLSelectElement).value as ArgumentInspector
  expanded.value = true
  if (scroll.value) scroll.value.scrollTop = 0
  showPreview()
}

function moveCaret(side: 'start' | 'end') {
  const edge = selected.value?.[side]
  if (edge !== undefined) emit('select', { start: edge, end: edge })
}

function restoreView(view: ArgumentView) {
  const saved = view.inspector ?? (view.bytes ? 'utf-8' : 'code-points')
  chosen.value = props.types.includes(saved) ? saved : undefined
  expanded.value = view.expanded === true
}

defineExpose({
  saveView: () => ({
    expanded: expanded.value,
    inspector: kind.value,
    bytes: kind.value === 'utf-8' || undefined,
  }),
  restoreView,
})
</script>

<template>
  <div class="argument-inspector">
    <div class="inspector-title">
      <button
        type="button"
        class="disclosure"
        :aria-label="label"
        :aria-expanded="expanded"
        :aria-controls="expanded ? id : undefined"
        @click="toggle"
      >
        <ChevronRight class="disclosure-icon" aria-hidden="true" />
        <template v-if="types.length === 1">{{ label }}</template>
      </button>
      <select
        v-if="types.length > 1"
        :value="kind"
        :aria-label="props.label + ' inspector type'"
        @change="choose"
      >
        <option v-for="type in types" :key="type" :value="type">
          {{ argumentInspectors[type].label }}
        </option>
      </select>
      <span v-if="!view.error" class="inspector-stats" role="status">
        <span v-if="selected" aria-label="Selected unit range">
          <TextCursorInput aria-hidden="true" />
          {{ selected.units.start }}-{{ selected.units.end }}
        </span>
        <span v-else aria-label="Caret position">
          <TextCursor aria-hidden="true" />
          {{ position.caretIndex }}
        </span>
        <span aria-label="Total units"><Sigma aria-hidden="true" /> {{ view.total }}</span>
      </span>
      <span v-else class="inspector-stats" role="status">
        <span aria-label="Unit count unavailable" :title="view.error">
          <Sigma aria-hidden="true" /> —
        </span>
      </span>
    </div>
    <div
      v-if="expanded"
      :id="id"
      ref="panel"
      class="point-view"
      role="region"
      :aria-label="props.label + ' Unicode inspector'"
    >
      <div class="toolbar point-actions" role="group" aria-label="Inspector actions">
        <button type="button" :disabled="!selected" @click="moveCaret('start')">
          Caret before
        </button>
        <button type="button" :disabled="!selected" @click="moveCaret('end')">Caret after</button>
        <button
          type="button"
          :disabled="disabled || !selected"
          @click="selected && emit('remove', selected)"
        >
          Delete
        </button>
        <button
          type="button"
          :disabled="!selected"
          @click="selected && emit('copy', selected.points.map(({ scalar }) => scalar).join(''))"
        >
          Copy text
        </button>
        <button
          type="button"
          :disabled="!selected"
          @click="
            selected && emit('copy', selected.points.map(({ notation }) => notation).join(' '))
          "
        >
          Copy notation
        </button>
        <button
          type="button"
          class="inspect-scalar"
          aria-label="Inspect"
          title="Inspect selected character"
          :disabled="selectedScalar === undefined"
          @click="selectedScalar !== undefined && emit('inspect', selectedScalar)"
        >
          <Search aria-hidden="true" /><span>Inspect</span>
        </button>
      </div>
      <div ref="scroll" class="point-scroll">
        <p v-if="view.error" class="muted">{{ view.error }}</p>
        <div
          v-else-if="view.groups.length"
          class="point-grid"
          :class="{ 'argument-byte-grid': kind !== 'code-points' }"
          role="group"
          :aria-label="props.label + (kind === 'code-points' ? ' code points' : ' ' + label)"
        >
          <button
            v-for="({ point, offset, text, description }, index) in view.groups"
            :key="point.start"
            type="button"
            class="point"
            :aria-label="description"
            :title="description"
            :aria-pressed="
              selected !== undefined && point.start >= selected.start && point.end <= selected.end
            "
            @click="emit('select', point)"
          >
            <bdi>{{ point.glyph }}</bdi>
            <code :class="{ 'argument-byte-values': kind !== 'code-points' }">{{ text }}</code>
            <span
              v-if="
                !selected &&
                (position.caretIndex === offset ||
                  (index === view.groups.length - 1 && position.caretIndex === view.total))
              "
              class="point-caret"
              :class="{ 'at-end': position.caretIndex === view.total }"
              aria-hidden="true"
            ></span>
          </button>
        </div>
        <p v-else class="muted">No input to inspect.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inspector-title {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.argument-inspector :is(button, select) {
  border-color: transparent;
  background: transparent;
  font-size: 12px;
}
.argument-inspector :is(button, select):hover:not(:disabled) {
  background: var(--raised);
}
.argument-inspector :is(.disclosure, select) {
  min-height: 28px;
  padding: 1px 4px;
}
.disclosure {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.disclosure[aria-expanded='true'] .disclosure-icon {
  rotate: 90deg;
}
.inspector-title select {
  border-radius: 2px;
  background: var(--surface);
  color-scheme: dark;
}
.inspector-stats,
.inspector-stats > span {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.inspector-stats {
  margin-inline-start: auto;
  padding-inline-end: var(--space-1);
  gap: var(--space-2);
  font-size: 12px;
  white-space: nowrap;
}
.inspector-stats .lucide {
  --icon-size: 13px;
  color: var(--muted);
}
.point-view {
  border-top: 1px solid var(--line);
  background: var(--surface);
}
.point-actions {
  gap: 0 2px;
  padding-inline: var(--space-1);
}
.point-actions button {
  min-height: 28px;
  padding: 1px 4px;
}
.point-actions .lucide {
  --icon-size: 13px;
  display: none;
}
.point-scroll {
  max-height: var(--inspector-scroll-height, min(28dvh, 180px));
  overflow: auto;
  overscroll-behavior: contain;
  padding: 4px 6px;
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
.argument-inspector .point {
  position: relative;
  display: inline-grid;
  justify-items: center;
  align-content: center;
  gap: 1px;
  min-height: 44px;
  min-width: 64px;
  padding: 2px 4px;
  line-height: 1.3;
}
.argument-inspector .point[aria-pressed='true'] {
  background-color: #27343e;
}
.point:focus-visible {
  outline-offset: -2px;
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
@media (max-width: 830px) {
  .point-view {
    background: transparent;
  }
  .point-actions button,
  .inspector-title :is(.disclosure, select) {
    min-height: var(--compact-control);
    padding-block: var(--compact-inset);
    font: 12px / var(--compact-leading) var(--sans);
  }
  .point-actions button {
    padding-inline: 2px;
    font-size: var(--compact-meta);
  }
  .inspector-title .disclosure {
    min-inline-size: var(--compact-control);
  }
  .point-actions .inspect-scalar {
    min-inline-size: var(--compact-control);
  }
  .point-actions .inspect-scalar span {
    display: none;
  }
  .point-actions .lucide {
    display: inline-block;
  }
  .argument-inspector .point {
    min-height: var(--compact-control);
    padding-block: var(--compact-tight);
  }
  .point-scroll {
    padding: var(--compact-tight) var(--compact-gap);
  }
}
</style>
