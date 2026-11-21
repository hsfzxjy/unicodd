<script setup lang="ts">
import ConsoleControls from './ConsoleControls.vue'

const emit = defineEmits<{ readRequest: [] }>()
</script>

<template>
  <section class="access-console" aria-labelledby="access-title">
    <h1 id="access-title">MONONYM access console</h1>
    <p dir="auto">
      MONONYM runs account and messaging services. From the local console, you can open guest
      sessions on its systems.
    </p>
    <p dir="auto">Mira needs a record that Support can’t find.</p>
    <button type="button" class="read-request" @click="emit('readRequest')">
      Read Mira’s request
    </button>
    <p class="guidance" dir="auto">
      Select items in the transcript or run a command at the prompt.
    </p>
    <ConsoleControls />
  </section>
</template>

<style scoped>
.access-console {
  max-inline-size: 40rem;
  margin-inline: auto;
  padding: 16px;
  border: 1px solid var(--line);
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
  .access-console {
    padding: var(--space-3);
  }
  .access-console h1 {
    font-size: 20px;
  }
}
</style>
