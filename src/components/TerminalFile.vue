<script setup lang="ts">
import { computed } from 'vue'
import { describe, notationTokens } from '../lib/unicode'
import type { Action } from '../lib/runtime'
import type { FileFormat } from '../lib/scenario'

const props = defineProps<{
  text: string
  path: string
  inspectLines: number[]
  inspectNotation: boolean
  format?: FileFormat
  busy: boolean
}>()
const emit = defineEmits<{ action: [Action] }>()
const tokens = computed(() => {
  const parts: { text: string; inspect?: boolean }[] = []
  let start = 0
  for (const match of notationTokens(props.text)) {
    parts.push({ text: props.text.slice(start, match.index) }, { text: match[0], inspect: true })
    start = match.index + match[0].length
  }
  parts.push({ text: props.text.slice(start) })
  return parts
})
const lines = computed(() =>
  props.inspectLines.length
    ? props.text
        .replace(/\r?\n$/u, '')
        .split(/\r?\n/u)
        .map((text, index) => ({
          text,
          points: props.inspectLines.includes(index + 1)
            ? Array.from(text, (scalar) => describe(scalar))
            : undefined,
        }))
    : [],
)
</script>

<template>
  <section class="terminal-file" :data-format="format" :aria-label="'File ' + path" tabindex="-1">
    <p class="file-path">
      <bdi>{{ path }}</bdi>
    </p>
    <pre
      class="resource-text"
      v-if="inspectNotation"
      data-resource-text
      dir="auto"
    ><template v-for="(token, index) in tokens" :key="index"><button
      v-if="token.inspect"
      type="button"
      class="terminal-link notation-link"
      :aria-disabled="busy || undefined"
      :aria-label="'Inspect ' + token.text"
      @click="emit('action', { type: 'inspect', character: token.text })"
    >{{ token.text }}</button><template v-else>{{ token.text }}</template></template></pre>
    <pre v-else-if="!inspectLines.length" class="resource-text" data-resource-text dir="auto">{{
      text
    }}</pre>
    <template v-else>
      <p
        class="resource-text"
        v-for="(line, index) in lines"
        :key="index"
        :class="{ 'character-bank': line.points }"
        :data-resource-text="line.points ? undefined : ''"
        dir="auto"
      >
        <template v-if="line.points">
          <button
            v-for="(point, position) in line.points"
            :key="position"
            type="button"
            class="terminal-link scalar-link"
            :aria-disabled="busy || undefined"
            :aria-label="'Inspect ' + point.notation + ', ' + point.glyph"
            @click="emit('action', { type: 'inspect', character: point.scalar })"
          >
            <bdi>{{ point.glyph }}</bdi>
          </button>
        </template>
        <template v-else>{{ line.text }}</template>
      </p>
      <p class="transcript-detail">Select a character to inspect it.</p>
    </template>
  </section>
</template>

<style scoped>
.terminal-file pre {
  max-width: 86ch;
}
.terminal-file[data-format='log'] pre {
  max-width: 106ch;
  font-size: 13px;
  line-height: 1.45;
}
.terminal-file[data-format='evidence'] {
  padding-inline-start: 8px;
  border-inline-start: 1px solid #6b859a;
}
.terminal-file[data-format] .file-path {
  color: var(--evidence);
}
.terminal-file .character-bank {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  max-width: 100%;
}
.terminal-file .character-bank + p:not(.character-bank) {
  margin-top: 10px;
}
.scalar-link {
  min-width: 30px;
  margin: 0;
  text-decoration: none;
  border-bottom-color: var(--control);
  font-size: 16px;
}
.terminal-file .notation-link {
  min-height: 0;
  padding: 0 2px;
  vertical-align: baseline;
}
@media (max-width: 600px), (pointer: coarse) {
  .terminal-file .notation-link {
    min-block-size: var(--touch-height);
  }
}
</style>
