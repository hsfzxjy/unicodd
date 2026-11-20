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
  max-inline-size: 1200px;
  margin-inline: auto;
  padding: var(--space-3);
  border: 1px solid var(--line);
  background: var(--inset);
  overflow-wrap: anywhere;
}
.access-console p {
  max-inline-size: 76ch;
  margin-block: var(--space-2);
}
.access-console h1 {
  color: var(--accent);
}
.read-request {
  min-block-size: 44px;
  max-inline-size: 100%;
  border-color: var(--accent);
  border-radius: 0;
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 650;
}
.read-request:hover {
  background: var(--text);
}
.guidance {
  color: var(--muted);
}
</style>
