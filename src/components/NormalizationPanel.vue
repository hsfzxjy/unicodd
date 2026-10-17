<script setup lang="ts">
import type { EngineStatus } from '../composables/useUnicodeNormalizer';
import { formatCodePoint } from '../unicode';

defineProps<{
  status: EngineStatus;
  error: string | null;
  engineId: string | null;
  normalizedText: string;
  normalizedScalars: Uint32Array;
}>();
</script>

<template>
  <section class="panel normalization-panel" aria-labelledby="normalization-heading">
    <div>
      <p class="eyebrow">Rust / WebAssembly</p>
      <h2 id="normalization-heading">NFC normalization</h2>
    </div>

    <div v-if="status === 'loading'" class="engine-result muted-result">
      Loading the Unicode engine…
    </div>
    <div v-else-if="status === 'error'" class="engine-result error-message" role="alert">
      {{ error }}
    </div>
    <div v-else class="engine-result">
      <span class="normalized-glyph">{{ normalizedText || '∅' }}</span>
      <code>
        {{
          normalizedScalars.length
            ? Array.from(normalizedScalars, formatCodePoint).join('  ')
            : 'Empty scalar sequence'
        }}
      </code>
    </div>

    <div class="engine-status">
      <span class="status-dot" :class="{ active: status === 'ready' }"></span>
      <span>{{ engineId ?? 'Engine pending' }}</span>
      <span>ABI 1</span>
    </div>
  </section>
</template>
