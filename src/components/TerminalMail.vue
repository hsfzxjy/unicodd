<script setup lang="ts">
import type { MailMessage } from '../lib/scenario'

defineProps<{ path?: string; messages: MailMessage[] }>()
</script>

<template>
  <section
    class="terminal-mail"
    :aria-label="path ? 'Mail ' + path : 'Inbox message'"
    tabindex="-1"
  >
    <p v-if="path" class="file-path">
      <bdi>{{ path }}</bdi>
    </p>
    <article v-for="message in messages" :key="message.id">
      <dl class="mail-headers">
        <dt class="transcript-label">From</dt>
        <dd>
          <bdi>{{ message.from }}</bdi>
        </dd>
        <dt class="transcript-label">To</dt>
        <dd>
          <bdi>{{ message.to }}</bdi>
        </dd>
        <template v-if="message.date">
          <dt class="transcript-label">Date</dt>
          <dd>
            <bdi>{{ message.date }}</bdi>
          </dd>
        </template>
        <dt class="transcript-label">Subject</dt>
        <dd class="mail-subject">
          <bdi>{{ message.subject }}</bdi>
        </dd>
      </dl>
      <pre class="resource-text transcript-prose" data-resource-text dir="auto">{{
        message.body
      }}</pre>
    </article>
  </section>
</template>

<style scoped>
.mail-headers {
  font-size: var(--transcript-meta-size, inherit);
  display: grid;
  grid-template-columns: 8ch minmax(0, 1fr);
  margin: 4px 0 6px;
}
.mail-headers dd {
  margin: 0;
}
.mail-headers .mail-subject {
  font: 650 14px/1.4 var(--sans);
}
.terminal-mail pre {
  max-width: 72ch;
  margin-top: 8px;
  line-height: 1.6;
}
.terminal-mail article + article {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
.terminal-mail:focus-visible {
  outline-offset: 3px;
}
@media (max-width: 830px) {
  .mail-headers {
    grid-template-columns: 7ch minmax(0, 1fr);
    column-gap: var(--space-1);
    margin-block: var(--space-1);
  }
  .terminal-mail pre {
    margin-top: var(--space-1);
    line-height: 1.5;
  }
}
</style>
