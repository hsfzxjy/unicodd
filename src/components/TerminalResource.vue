<script setup lang="ts">
import TerminalFile from './TerminalFile.vue'
import TerminalMail from './TerminalMail.vue'
import type { Action } from '../lib/runtime'
import type { ReadOutput } from '../composables/useTerminalReads'

defineProps<{ output: ReadOutput; busy: boolean }>()
const emit = defineEmits<{ action: [Action] }>()
</script>

<template>
  <TerminalFile
    v-if="output.kind === 'file'"
    :path="output.path"
    :text="output.text"
    :inspect-lines="output.inspectLines"
    :inspect-notation="output.inspectNotation"
    :format="output.format"
    :busy="busy"
    @action="emit('action', $event)"
  />
  <TerminalMail v-else :path="output.path" :messages="output.messages" />
</template>

<style scoped>
:where(.terminal-file, .terminal-mail) :deep(.file-path) {
  color: var(--muted);
  font-size: var(--transcript-meta-size, 12px);
}
:where(.terminal-file, .terminal-mail) :deep(.resource-text) {
  margin: 3px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
