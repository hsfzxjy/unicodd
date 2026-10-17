<script setup lang="ts">
import { computed } from 'vue';
import { formatHex, inspectScalar } from '../unicode';

const props = defineProps<{
  scalar: number | null;
}>();

const details = computed(() => (props.scalar === null ? null : inspectScalar(props.scalar)));
const utf8 = computed(() =>
  details.value ? Array.from(details.value.utf8Bytes, (byte) => formatHex(byte)).join(' ') : '',
);
const utf16 = computed(() =>
  details.value ? Array.from(details.value.utf16Units, (unit) => formatHex(unit, 4)).join(' ') : '',
);
</script>

<template>
  <section class="panel inspector-panel" aria-labelledby="inspector-heading">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Character inspector</p>
        <h2 id="inspector-heading">One scalar, three views.</h2>
      </div>
      <span class="status-dot" aria-label="Browser-native properties only"></span>
    </div>

    <template v-if="details">
      <div class="character-stage" aria-label="Rendered character">{{ details.display }}</div>
      <dl class="property-list">
        <div>
          <dt>Unicode scalar</dt>
          <dd>{{ details.codePoint }}</dd>
        </div>
        <div>
          <dt>UTF-8 bytes</dt>
          <dd>{{ utf8 || '—' }}</dd>
        </div>
        <div>
          <dt>UTF-16 units</dt>
          <dd>{{ utf16 || '—' }}</dd>
        </div>
      </dl>
      <p class="supporting-copy inspector-note">
        Bytes and code units are different representations of the same selected scalar.
      </p>
    </template>
    <div v-else class="empty-state inspector-empty">Choose a scalar to inspect it.</div>
  </section>
</template>
