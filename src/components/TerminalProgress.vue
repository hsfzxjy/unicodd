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
    { duration: props.progress.scope === 'scenario' ? 560 : 320, easing: 'ease-out' },
  )
})
</script>

<template>
  <section ref="band" class="progress-band" :data-scope="progress.scope">
    <h3 tabindex="-1">
      <Check v-if="progress.scope === 'scenario'" aria-hidden="true" />
      <Flag v-else aria-hidden="true" />
      <bdi>{{ progress.title }}</bdi>
    </h3>
    <p class="transcript-prose" dir="auto">{{ progress.text }}</p>
  </section>
</template>

<style scoped>
.progress-band {
  --progress-ink: var(--verification-ink);
  --progress-edge: #84b5d0;
  --progress-fill: var(--verification-fill);
  --progress-highlight: #2b4654;
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
  max-inline-size: 76ch;
  margin-top: 3px;
}
.progress-band[data-scope='scenario'] {
  --progress-ink: var(--completion-ink);
  --progress-edge: #91bd9b;
  --progress-fill: var(--completion-fill);
  --progress-highlight: #345244;
  padding: 6px var(--space-3);
  border-inline-start-width: 4px;
}
.progress-band:has(+ [data-closeout]) {
  margin-block-end: var(--space-1);
}
.progress-band[data-scope='scenario'] h3 {
  font-size: 17px;
  line-height: 1.3;
}
@media (max-width: 830px) {
  .progress-band[data-scope='scenario'] {
    padding-inline: var(--space-2);
  }
}
</style>
