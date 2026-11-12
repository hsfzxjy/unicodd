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
        <dt>From</dt>
        <dd>
          <bdi>{{ message.from }}</bdi>
        </dd>
        <dt>To</dt>
        <dd>
          <bdi>{{ message.to }}</bdi>
        </dd>
        <template v-if="message.date">
          <dt>Date</dt>
          <dd>
            <bdi>{{ message.date }}</bdi>
          </dd>
        </template>
        <dt>Subject</dt>
        <dd class="mail-subject">
          <bdi>{{ message.subject }}</bdi>
        </dd>
      </dl>
      <pre data-resource-text dir="auto">{{ message.body }}</pre>
    </article>
  </section>
</template>
