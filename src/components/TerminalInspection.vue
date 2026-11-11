<script setup lang="ts">
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
  const seen = new Set([props.row.point.scalar])
  return props.row.normalization.map(({ form, result }) => {
    if (!result.ok) return { form, error: result.error.message }
    const offerInsert = Boolean(result.value) && !seen.has(result.value)
    seen.add(result.value)
    return { form, points: inspect(result.value), text: result.value, offerInsert }
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
          :aria-disabled="busy || undefined"
          @click="emit('action', { type: 'copy', text: row.point.scalar })"
        >
          Copy
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
    <p v-if="row.details.ok" class="inspection-metadata meta">
      <bdi v-if="row.details.value.name">{{ row.details.value.name }}</bdi>
      <span>{{ row.details.value.script.replaceAll('_', ' ') }} script</span>
    </p>
    <p class="inspection-encoding meta">
      <span
        >UTF-8 <code>{{ utf8 }}</code></span
      >
      <span
        >UTF-16 <code>{{ utf16 }}</code></span
      >
    </p>
    <dl class="inspection-normalization" aria-label="Normalization">
      <div
        v-for="{ form, points, text, offerInsert, error } in normalization"
        :key="form"
        class="inspection-form"
      >
        <dt>
          <code>{{ form }}</code>
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
      <p class="meta">
        Related scalars from UTS #39 · Unicode {{ row.details.value.unicodeVersion }}
      </p>
    </details>
  </section>
</template>
