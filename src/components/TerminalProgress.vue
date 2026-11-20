<script setup lang="ts">
import { Check, Flag } from '@lucide/vue'
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
      <Check v-if="progress.scope === 'scenario'" aria-hidden="true" />
      <Flag v-else aria-hidden="true" />
      <bdi>{{ progress.title }}</bdi>
    </h3>
    <p dir="auto">{{ progress.text }}</p>
  </section>
</template>

<style scoped>
.progress-band {
  --progress-ink: #c3e0f3;
  --progress-edge: #8dbad8;
  --progress-fill: #203241;
  --progress-highlight: #32536a;
  margin-block: var(--space-2);
  padding: 5px var(--space-2);
  border-inline-start: 3px solid var(--progress-edge);
  background: var(--progress-fill);
  color: var(--text);
}
.progress-band h3 {
  display: flex;
  gap: var(--space-1);
  align-items: center;
  color: var(--progress-ink);
  font: 700 14px/1.4 var(--sans);
}
.progress-band p {
  margin-top: 3px;
  font-size: 13px;
}
.progress-band[data-scope='scenario'] {
  --progress-ink: #d4f3e5;
  --progress-edge: #96cdb6;
  --progress-fill: #1d362f;
  --progress-highlight: #345c50;
  padding: 6px var(--space-2);
  border-inline-start-width: 4px;
}
.progress-band[data-scope='scenario'] h3 {
  font-size: 16px;
}
</style>
