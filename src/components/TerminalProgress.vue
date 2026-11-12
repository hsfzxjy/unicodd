<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { ProgressTransition } from '../lib/runtime'

const props = defineProps<{ progress: ProgressTransition; fresh: boolean }>()
const band = ref<HTMLElement>()

onMounted(() => {
  if (!props.fresh || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  band.value?.animate(
    [{ backgroundColor: 'var(--progress-highlight)' }, { backgroundColor: 'var(--progress-fill)' }],
    { duration: props.progress.scope === 'scenario' ? 800 : 460, easing: 'ease-out' },
  )
})
</script>

<template>
  <section ref="band" class="progress-band" :data-scope="progress.scope">
    <h3>
      <span aria-hidden="true">{{ progress.scope === 'scenario' ? '✓' : '◆' }}</span>
      <bdi>{{ progress.title }}</bdi>
    </h3>
    <p dir="auto">{{ progress.text }}</p>
  </section>
</template>
