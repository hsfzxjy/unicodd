<script setup lang="ts">
import { computed } from 'vue'
import { describe } from '../lib/unicode'
import type { Action } from '../lib/runtime'

const props = defineProps<{ text: string; path: string; inspectLines: number[] }>()
const emit = defineEmits<{ action: [Action] }>()
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
  <section class="terminal-file" :aria-label="'File ' + path">
    <p class="file-path">
      <bdi>{{ path }}</bdi>
    </p>
    <pre v-if="!inspectLines.length" data-resource-text dir="auto">{{ text }}</pre>
    <template v-else>
      <p
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
            :aria-label="'Inspect ' + point.notation + ', ' + point.glyph"
            @click="emit('action', { type: 'inspect', character: point.scalar })"
          >
            <bdi>{{ point.glyph }}</bdi>
          </button>
        </template>
        <template v-else>{{ line.text }}</template>
      </p>
      <p class="meta">Select a character to inspect it.</p>
    </template>
  </section>
</template>
