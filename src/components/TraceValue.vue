<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Value } from '../types'

const props = defineProps<{ value: Value }>()
const expanded = ref(false)
const preview = computed(() => {
  if (props.value.type !== 'text') return { text: String(props.value.value), truncated: false }
  let text = ''
  let count = 0
  for (const scalar of props.value.value) {
    if (count++ === 96 && !expanded.value) return { text, truncated: true }
    text += scalar
  }
  return { text, truncated: false }
})
</script>

<template>
  <div class="trace-value">
    <span v-if="value.type === 'text' && !value.value" class="meta">Empty text</span>
    <bdi v-else class="mono">{{ preview.text }}{{ preview.truncated ? '…' : '' }}</bdi>
    <button v-if="preview.truncated || expanded" type="button" :aria-expanded="expanded" @click="expanded = !expanded">
      {{ expanded ? 'Show less' : 'Show full value' }}
    </button>
  </div>
</template>
