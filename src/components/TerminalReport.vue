<script setup lang="ts">
import type { Action, Output } from '../lib/runtime'
import { inspectRange } from '../lib/unicode'

const props = defineProps<{
  rows: Extract<Output, { kind: 'report' }>['rows']
  busy: boolean
  canInsert: boolean
  canReplace: boolean
}>()
const emit = defineEmits<{ action: [Action] }>()
const sourceCoordinates = [
  ['utf8', 'UTF-8'],
  ['utf16', 'UTF-16'],
  ['scalars', 'Scalars'],
  ['graphemes', 'Graphemes'],
] as const

function hexadecimal(value: number, width: number) {
  return value.toString(16).toUpperCase().padStart(width, '0')
}

function usePayload(text: string) {
  if (!props.busy && props.canInsert)
    emit('action', { type: 'editPayload', mode: props.canReplace ? 'replace' : 'insert', text })
}
</script>

<template>
  <div class="terminal-report" tabindex="-1">
    <div
      v-for="(record, number) in rows"
      :key="number"
      class="report-row"
      :class="{ 'audit-row': record.audit }"
    >
      <strong
        ><bdi>{{ record.label }}</bdi></strong
      >
      <span v-if="record.details" class="report-details">
        <bdi v-for="(detail, index) in record.details" :key="index">{{ detail }}</bdi>
      </span>
      <span v-if="record.hex" class="report-hex" dir="ltr">
        <span v-if="record.hex.chunkStart" class="report-chunk">chunk</span>
        <button
          v-for="(byte, index) in record.hex.bytes"
          :key="index"
          type="button"
          class="terminal-link"
          :class="{
            'report-invalid-byte':
              record.hex.highlight &&
              record.hex.offset + index >= record.hex.highlight[0] &&
              record.hex.offset + index < record.hex.highlight[1],
          }"
          :aria-label="
            'Use offset 0x' +
            hexadecimal(record.hex.offset + index, 4) +
            ' for byte ' +
            hexadecimal(byte, 2)
          "
          :aria-disabled="busy || !canInsert || undefined"
          @click="usePayload('0x' + hexadecimal(record.hex.offset + index, 4))"
        >
          {{ hexadecimal(byte, 2) }}
        </button>
      </span>
      <span v-else-if="record.fields.length" class="report-fields" data-resource-text>
        <bdi v-for="(field, index) in record.fields" :key="index">{{ field }}</bdi>
      </span>
      <template v-if="record.source">
        <bdi class="report-source" data-resource-text
          >{{ record.source.before }}<mark>{{ record.source.hit }}</mark
          >{{ record.source.after }}</bdi
        >
        <span class="report-details" dir="ltr">
          <template v-for="[space, label] in sourceCoordinates" :key="space">
            <button
              v-if="canInsert"
              type="button"
              class="terminal-link"
              :aria-label="'Use ' + label + ' range ' + record.source.coordinates[space].join('-')"
              :aria-disabled="busy || undefined"
              @click="usePayload(record.source.coordinates[space].join('-'))"
            >
              {{ label }} {{ record.source.coordinates[space].join('–') }}
            </button>
            <span v-else>{{ label }} {{ record.source.coordinates[space].join('–') }}</span>
            <span v-if="space === 'graphemes' && !record.source.coordinates.exactGraphemes"
              >(covering)</span
            >
          </template>
        </span>
      </template>
      <button
        v-if="record.serialized !== undefined"
        type="button"
        class="terminal-link"
        :aria-disabled="busy || undefined"
        @click="emit('action', { type: 'copy', text: record.serialized })"
      >
        {{ record.copyLabel ?? (record.audit ? 'Copy line' : 'Copy cursor') }}
      </button>
      <span v-if="record.inspect" class="report-points">
        <template v-for="(field, index) in record.inspect" :key="index">
          <button
            v-for="point in inspectRange(field, 0, 24)"
            :key="point.start"
            type="button"
            class="terminal-link"
            :aria-disabled="busy || undefined"
            @click="emit('action', { type: 'inspect', character: point.scalar })"
          >
            {{ point.notation }}
          </button>
        </template>
      </span>
    </div>
  </div>
</template>

<style scoped>
.terminal-report {
  display: grid;
  gap: 3px;
  overflow-wrap: anywhere;
}
.report-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
}
.report-row strong {
  color: var(--muted);
}
.report-hex {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.15rem 0.3rem;
  font-variant-numeric: tabular-nums;
  user-select: text;
}
.report-hex button {
  padding-inline: 0.2rem;
}
.report-chunk {
  color: var(--muted);
}
.report-hex .report-invalid-byte {
  border-bottom: 2px solid currentColor;
  font-weight: 700;
}
.report-source {
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.report-source mark {
  color: inherit;
  background: #304d42;
  border-bottom: 1px solid currentColor;
}

.report-fields,
.report-points,
.report-details {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
  min-width: 0;
}
.report-fields bdi {
  white-space: pre-wrap;
}
.report-points {
  flex-basis: 100%;
}
.audit-row {
  padding-block: 3px;
}
.audit-row .report-fields {
  flex-basis: 100%;
}
.report-details {
  color: var(--muted);
}
@media (min-width: 540px) {
  .audit-row .report-fields {
    flex-basis: auto;
  }
}
</style>
