<script setup lang="ts">
import { ChevronRight, Copy } from '@lucide/vue'
import { computed } from 'vue'
import type { Action, Inspection } from '../lib/runtime'
import { describe, inspect } from '../lib/unicode'

const props = defineProps<{
  row: Inspection
  canInsertCommand: boolean
  canInsertPayload: boolean
  canReplace: boolean
  busy: boolean
}>()
const emit = defineEmits<{ action: [Action] }>()
function insert(text: string) {
  if (props.busy || (!props.canInsertPayload && !props.canInsertCommand)) return
  emit(
    'action',
    props.canInsertPayload
      ? { type: 'editPayload', mode: 'insert', text }
      : { type: 'insertCommand', text },
  )
}

const hex = (value: number) => value.toString(16).toUpperCase().padStart(2, '0')
const utf8 = computed(() =>
  Array.from(new TextEncoder().encode(props.row.point.scalar), hex).join(' '),
)
const utf16 = computed(() =>
  Array.from({ length: props.row.point.scalar.length }, (_, index) =>
    hex(props.row.point.scalar.charCodeAt(index)).padStart(4, '0'),
  ).join(' '),
)
const confusables = computed(() =>
  props.row.details.ok
    ? props.row.details.value.confusables.map(({ scalar, script }) => ({
        ...describe(scalar),
        script: script.replaceAll('_', ' '),
      }))
    : [],
)

const normalization = computed(() => {
  const seen = new Map<string, string[]>()
  return props.row.normalization.map(({ form, result }) => {
    if (!result.ok) return { form, error: result.error.message }
    const matching = seen.get(result.value)
    const sameForms: string[] = []
    if (matching) matching.push(form)
    else seen.set(result.value, sameForms)
    const offerInsert =
      Boolean(result.value) && result.value !== props.row.point.scalar && !matching
    return {
      form,
      points: inspect(result.value),
      text: result.value,
      offerInsert,
      sameForms,
      repeated: Boolean(matching),
    }
  })
})
</script>

<template>
  <section class="inspection" :aria-label="'Unicode ' + row.point.notation" tabindex="-1">
    <div class="inspection-summary">
      <button
        type="button"
        class="terminal-link inspection-point"
        :aria-label="'Inspect ' + row.point.notation + ', ' + row.point.glyph"
        :aria-disabled="busy || undefined"
        @click="emit('action', { type: 'inspect', character: row.point.scalar })"
      >
        <bdi>{{ row.point.glyph }}</bdi>
        <code>{{ row.point.notation }}</code>
      </button>
      <span v-if="row.category" class="inspection-category">{{ row.category }}</span>
      <div class="inspection-actions">
        <button
          type="button"
          class="icon-button"
          aria-label="Copy"
          title="Copy character"
          :aria-disabled="busy || undefined"
          @click="emit('action', { type: 'copy', text: row.point.scalar })"
        >
          <Copy aria-hidden="true" />
        </button>
        <button
          type="button"
          :aria-disabled="busy || undefined"
          :aria-label="'Copy notation ' + row.point.notation"
          @click="emit('action', { type: 'copy', text: row.point.notation })"
        >
          Copy U+
        </button>
        <button
          type="button"
          :aria-disabled="busy || undefined"
          :disabled="busy || (!canInsertPayload && !canInsertCommand)"
          :title="canInsertPayload ? 'Insert into active parameter' : 'Insert into command prompt'"
          @click="insert(row.point.scalar)"
        >
          Insert
        </button>
        <button
          v-if="canInsertPayload"
          type="button"
          :aria-disabled="busy || !canReplace"
          :tabindex="canReplace ? undefined : -1"
          @click="
            canReplace &&
            emit('action', { type: 'editPayload', mode: 'replace', text: row.point.scalar })
          "
        >
          Replace
        </button>
      </div>
    </div>
    <p v-if="row.details.ok || row.category" class="inspection-metadata meta">
      <span v-if="row.category" class="inspection-category compact-category">{{
        row.category
      }}</span>
      <template v-if="row.details.ok">
        <bdi v-if="row.details.value.name">{{ row.details.value.name }}</bdi>
        <span>{{ row.details.value.script.replaceAll('_', ' ') }} script</span>
      </template>
    </p>
    <p class="inspection-encoding meta">
      <span
        ><span class="transcript-label">UTF-8</span> <code>{{ utf8 }}</code></span
      >
      <span
        ><span class="transcript-label">UTF-16</span> <code>{{ utf16 }}</code></span
      >
    </p>
    <dl class="inspection-normalization" aria-label="Normalization">
      <div
        v-for="{ form, points, text, offerInsert, error, repeated, sameForms } in normalization"
        :key="form"
        class="inspection-form transcript-list-row"
        :class="{ 'inspection-form-repeat': repeated }"
      >
        <dt>
          <code>{{ form }}</code>
          <code v-for="same in sameForms" :key="same" class="inspection-form-equivalent">{{
            same
          }}</code>
        </dt>
        <dd>
          <template v-if="points">
            <span class="inspection-sequence">
              <button
                v-for="point in points"
                :key="point.start"
                type="button"
                class="terminal-link inspection-point"
                :aria-label="form + ': Inspect ' + point.notation + ', ' + point.glyph"
                :aria-disabled="busy || undefined"
                @click="emit('action', { type: 'inspect', character: point.scalar })"
              >
                <bdi>{{ point.glyph }}</bdi>
                <code>{{ point.notation }}</code>
              </button>
              <span v-if="!points.length" class="meta">Empty</span>
            </span>
            <button
              v-if="offerInsert && text !== undefined"
              type="button"
              :aria-disabled="busy || undefined"
              :aria-label="'Insert ' + form"
              :disabled="busy || (!canInsertPayload && !canInsertCommand)"
              @click="insert(text)"
            >
              Insert
            </button>
          </template>
          <span v-else class="error">{{ error }}</span>
        </dd>
      </div>
    </dl>
    <details v-if="row.details.ok && confusables.length" class="inspection-confusables">
      <summary>
        <ChevronRight class="disclosure-icon" aria-hidden="true" />
        Confusables ({{ confusables.length
        }}{{ row.details.value.confusablesTruncated ? '+' : '' }})
      </summary>
      <div class="inspection-sequence">
        <button
          v-for="point in confusables"
          :key="point.scalar"
          type="button"
          class="terminal-link inspection-point"
          :aria-label="'Inspect confusable ' + point.notation + ', ' + point.script"
          :aria-disabled="busy || undefined"
          @click="emit('action', { type: 'inspect', character: point.scalar })"
        >
          <bdi>{{ point.glyph }}</bdi>
          <code>{{ point.notation }}</code>
          <span class="meta">{{ point.script }}</span>
        </button>
      </div>
      <p class="transcript-detail">
        Related scalars from UTS #39 · Unicode {{ row.details.value.unicodeVersion }}
      </p>
    </details>
  </section>
</template>

<style scoped>
details[open] > summary .disclosure-icon {
  rotate: 90deg;
}
.inspection-metadata {
  display: flex;
  flex-wrap: wrap;
  column-gap: 12px;
  margin: 4px 0;
}
.inspection-metadata bdi,
.inspection-encoding code {
  color: var(--text);
  font-weight: 550;
}
.inspection-confusables {
  margin-top: 5px;
}
.inspection-confusables summary {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--accent);
  cursor: pointer;
  min-height: var(--control-height);
  list-style: none;
}
.inspection-confusables summary::-webkit-details-marker {
  display: none;
}
.inspection-confusables .inspection-sequence {
  margin-block: 3px;
}
.inspection-summary,
.inspection-actions,
.inspection-sequence,
.inspection-form dd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 8px;
}
.inspection {
  min-width: 0;
  margin-top: 3px;
}
.inspection:focus-visible {
  outline-offset: 3px;
}
.inspection-summary {
  column-gap: 12px;
}
.inspection-actions {
  column-gap: var(--space-1);
}
.inspection-category {
  color: var(--muted);
  font-size: 12px;
}
.inspection .inspection-point {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  margin-inline-start: 0;
  text-decoration: none;
}
.inspection-point bdi {
  overflow-wrap: anywhere;
}
.inspection-summary > .inspection-point bdi {
  font-size: 20px;
  line-height: 1.2;
}
.inspection-point code {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.inspection button:not(.terminal-link, .icon-button) {
  min-height: var(--control-height);
  padding: 2px 8px;
  font: 12px var(--sans);
}
.inspection-normalization {
  margin: 4px 0 0;
}
.inspection-form {
  display: grid;
  grid-template-columns: 5ch minmax(0, 1fr);
}
.inspection-form dt {
  display: flex;
  align-items: center;
  min-height: var(--control-height);
  align-self: start;
  color: var(--muted);
}
.inspection-form-equivalent,
.inspection .compact-category,
.inspection-metadata:not(:has(bdi, span:not(.compact-category))) {
  display: none;
}
.inspection-form dd {
  align-items: flex-start;
  flex-wrap: nowrap;
  margin: 0;
}
.inspection-form dd > button {
  flex: none;
  white-space: nowrap;
}
.inspection-sequence {
  min-width: 0;
}
@media (max-width: 600px), (pointer: coarse) {
  .inspection-confusables summary,
  .inspection button:not(.terminal-link, .icon-button) {
    min-block-size: var(--touch-height);
  }
}
.inspection-encoding {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  margin: 4px 0;
}
@media (max-width: 830px) {
  .inspection {
    display: grid;
    gap: var(--compact-tight);
    margin: 0;
  }
  .inspection :is(.inspection-category, .inspection-metadata, .inspection-encoding) {
    font-size: var(--compact-meta);
  }
  .inspection :is(.inspection-metadata, .inspection-encoding) {
    margin: 0;
    line-height: var(--compact-leading);
  }
  .inspection-summary > .inspection-category {
    display: none;
  }
  .inspection .compact-category {
    display: inline;
  }
  .inspection .inspection-metadata {
    display: block;
  }
  .inspection-metadata > :not(:first-child)::before {
    content: ' · ';
  }
  .inspection .inspection-point,
  .inspection button:not(.terminal-link, .icon-button),
  .inspection-confusables summary {
    min-height: var(--control-height);
    padding-block: var(--compact-tight);
  }
  .inspection .inspection-point {
    gap: var(--compact-gap);
  }
  .inspection button:not(.terminal-link, .icon-button) {
    padding-inline: var(--compact-section);
  }
  .inspection-actions {
    gap: var(--compact-tight);
  }
  .inspection-point bdi {
    font-size: 15px;
  }
  .inspection-form-repeat {
    display: none;
  }
  .inspection-form dt {
    display: grid;
    align-content: center;
    min-height: var(--control-height);
    font-size: var(--compact-meta);
    line-height: 1.15;
  }
  .inspection-form-equivalent {
    display: block;
  }
  .inspection-normalization {
    margin: var(--compact-tight) 0 0;
  }
  .inspection-form {
    grid-template-columns: 4ch minmax(0, 1fr);
    column-gap: var(--compact-gap);
    box-shadow: inset 0 1px var(--line);
  }
  .inspection-form:has(.inspection-form-equivalent:nth-child(4)) {
    grid-template-columns: 8ch minmax(0, 1fr);
  }
  .inspection-form dt:has(.inspection-form-equivalent:nth-child(4)) {
    grid-template-columns: 1fr 1fr;
  }
  .inspection-form dd {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--compact-gap);
  }
  .inspection-form .inspection-point {
    padding-inline: var(--compact-tight);
    gap: var(--compact-tight);
    font-size: 12px;
  }
  .inspection-form dd > button {
    grid-column: 2;
  }
  .inspection-confusables {
    margin: 0;
  }
  .inspection-confusables .inspection-sequence {
    margin-block: 0 var(--compact-tight);
  }
}

@media (max-width: 600px) {
  .inspection-summary,
  .inspection-sequence,
  .inspection-form dd {
    gap: var(--compact-tight) var(--compact-gap);
  }
}
</style>
