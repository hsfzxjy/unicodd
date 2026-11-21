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
      <h3 class="mail-subject">
        <bdi>{{ message.subject }}</bdi>
      </h3>
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
      </dl>
      <pre class="resource-text transcript-prose" data-resource-text dir="auto">{{
        message.body
      }}</pre>
    </article>
  </section>
</template>

<style scoped>
.terminal-mail {
  max-inline-size: 42rem;
  padding: 6px var(--space-3) var(--space-2);
  color: var(--record-ink);
  background: #2a2a25;
}
.terminal-mail .file-path,
.mail-headers {
  color: #c6bdae;
}
.mail-headers {
  font: 12px/1.35 var(--mono);
  display: grid;
  grid-template-columns: 8ch minmax(0, 1fr);
  margin-block: var(--space-1);
}
.mail-headers dt {
  color: inherit;
  font-size: inherit;
  font-weight: 550;
}
.mail-headers dd {
  margin: 0;
}
.mail-subject {
  font: 400 20px/1.2 var(--record-display);
}
.terminal-mail pre {
  max-width: 72ch;
  margin-block: 0;
  line-height: 1.6;
}
.terminal-mail article + article {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid #62584a;
}
.terminal-mail:focus-visible {
  outline-offset: 3px;
}
@media (max-width: 830px) {
  .terminal-mail {
    padding: var(--space-1) var(--space-2) 6px;
  }
  .mail-subject {
    font-size: 18px;
  }
  .mail-headers {
    grid-template-columns: 7ch minmax(0, 1fr);
    column-gap: var(--space-1);
  }
  .terminal-mail pre {
    line-height: 1.5;
  }
}
</style>
