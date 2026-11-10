<script setup lang="ts">
import { computed } from 'vue'
import type { Action, Inspection } from '../lib/runtime'
import { inspect } from '../lib/unicode'

const props = defineProps<{
  row: Inspection
  canInsertPayload: boolean
  canReplace: boolean
  busy: boolean
}>()
const emit = defineEmits<{ action: [Action] }>()
function insert(text: string) {
  emit(
    'action',
    props.canInsertPayload
      ? { type: 'editPayload', mode: 'insert', text }
      : { type: 'insertCommand', text },
  )
}

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
          :title="canInsertPayload ? 'Insert into active payload' : 'Insert into command prompt'"
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
              @click="insert(text)"
            >
              Insert
            </button>
          </template>
          <span v-else class="error">{{ error }}</span>
        </dd>
      </div>
    </dl>
  </section>
</template>
