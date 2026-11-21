<script setup lang="ts">
import ConsoleControls from './ConsoleControls.vue'

const emit = defineEmits<{ readRequest: [] }>()
</script>

<template>
  <div class="access-frame">
    <section class="access-console" aria-labelledby="access-title">
      <h1 id="access-title">MONONYM access console</h1>
      <p dir="auto">Guest access to MONONYM account and messaging services.</p>
      <button type="button" class="read-request" @click="emit('readRequest')">
        Read Mira’s request
      </button>
      <p class="guidance" dir="auto">
        You can open files and messages from the transcript. If you prefer to type, use the prompt.
      </p>
      <ConsoleControls />
    </section>
  </div>
</template>

<style scoped>
.access-frame {
  max-inline-size: var(--terminal-width);
  margin-inline: auto;
}
.access-console {
  max-inline-size: 40rem;
  padding: 16px var(--reading-inset);
  border: var(--terminal-rule);
  border-block-start: 2px solid var(--accent);
  background: var(--surface);
  overflow-wrap: anywhere;
}
.access-console p {
  max-inline-size: 76ch;
  margin-block: var(--space-2);
}
.access-console h1 {
  color: var(--record-ink);
  font: 400 22px/1.25 var(--record-display);
}
.read-request {
  min-block-size: 44px;
  max-inline-size: 100%;
  border-color: var(--accent);
  border-radius: 0;
  background: var(--accent);
  color: var(--accent-ink);
  padding-inline: var(--space-3);
  font-weight: 650;
}
.read-request:hover {
  background: var(--accent-hover);
}
.guidance {
  color: var(--muted);
}
.access-console :deep(.console-controls summary) {
  background: var(--raised);
}
@media (max-width: 600px) {
  .access-console h1 {
    font-size: 20px;
  }
}
</style>
