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
  <ul class="terminal-report transcript-list" role="list" aria-label="Report" tabindex="-1">
    <li
      v-for="(record, number) in rows"
      :key="number"
      class="report-row transcript-list-row"
      :class="{ 'audit-row': record.audit, 'source-row': record.source }"
    >
      <strong class="report-label"
        ><bdi>{{ record.label }}</bdi></strong
      >
      <div class="report-content">
        <span v-if="record.details" class="report-details">
          <bdi v-for="(detail, index) in record.details" :key="index">{{ detail }}</bdi>
        </span>
        <span v-if="record.hex" class="report-hex" dir="ltr">
          <span v-if="record.hex.chunkStart" class="transcript-label">chunk</span>
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
          <span class="source-coordinates" dir="ltr">
            <component
              :is="canInsert ? 'button' : 'span'"
              v-for="[space, label] in sourceCoordinates"
              :key="space"
              class="source-coordinate"
              :class="{ 'terminal-link': canInsert }"
              :type="canInsert ? 'button' : undefined"
              :aria-label="
                canInsert
                  ? 'Use ' +
                    label +
                    ' range ' +
                    record.source.coordinates[space].join('-') +
                    (space === 'graphemes' && !record.source.coordinates.exactGraphemes
                      ? ', covering'
                      : '')
                  : undefined
              "
              :aria-disabled="canInsert && busy ? true : undefined"
              @click="usePayload(record.source.coordinates[space].join('-'))"
              >{{ label }} {{ record.source.coordinates[space].join('–')
              }}<span v-if="space === 'graphemes' && !record.source.coordinates.exactGraphemes">
                (covering)</span
              ></component
            >
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
    </li>
  </ul>
</template>

<style scoped>
.terminal-report {
  --list-label-width: 32%;
  row-gap: 3px;
  overflow-wrap: anywhere;
}
.report-content {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
  min-width: 0;
}
.report-label {
  min-width: 0;
  font-weight: 650;
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
.report-hex .report-invalid-byte {
  border-bottom: 2px solid currentColor;
  font-weight: 700;
}
.report-source {
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.source-row {
  padding-block: 2px;
}
.source-row .report-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  row-gap: 4px;
}
.source-coordinates {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 6px;
  color: var(--evidence);
  font: 12px/16px var(--mono);
  font-variant-numeric: tabular-nums;
}
.source-coordinate,
.source-coordinate.terminal-link {
  align-content: center;
  min-height: 24px;
  min-width: 0;
  padding: 2px 3px;
  margin: 0;
  border: 1px solid transparent;
  font: inherit;
  text-align: start;
  overflow-wrap: anywhere;
}
.source-coordinate.terminal-link:hover:not([aria-disabled='true']) {
  background: var(--raised);
}
.source-row .report-content > button {
  justify-self: start;
}
.source-row .report-points {
  gap: 2px 8px;
}
@media (min-width: 900px) {
  .source-row .report-content {
    grid-template-columns: minmax(0, 1fr) minmax(0, 32ch);
    align-items: start;
  }
  .source-row .report-content > * {
    grid-column: 1;
  }
  .source-row .source-coordinates {
    grid-column: 2;
    grid-row-end: span 2;
  }
  .source-row :is(.report-details, .report-fields) {
    grid-column: 1 / -1;
  }
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
@media (max-width: 600px) {
  .terminal-report {
    grid-template-columns: minmax(0, 1fr);
  }
  .terminal-report:has(.source-row) {
    row-gap: 0;
  }
  .report-row {
    display: flex;
    flex-wrap: wrap;
    gap: 2px var(--space-2);
  }
  .report-row.source-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
    padding-block: 0;
  }
  .source-row .report-content {
    row-gap: 0;
  }
}
</style>
