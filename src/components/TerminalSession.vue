<script setup lang="ts">
import { Check, CircleDashed } from '@lucide/vue'
import type { createRuntime, Session } from '../lib/runtime'
import type { TerminalPanel } from '../lib/workspace'

defineProps<{
  openPanel?: TerminalPanel
  session: Session
  hostStatus?: ReturnType<typeof createRuntime>['hostStatus']
  permissionLabel: string
  objective: string
  goalStatus: string
  caseComplete: boolean
  campaignFinished: boolean
  busy: boolean
}>()
const emit = defineEmits<{ restart: [] }>()
</script>

<template>
  <section
    :hidden="openPanel !== 'goal'"
    id="goal-details"
    class="title-panel"
    aria-labelledby="goal-heading"
    tabindex="0"
  >
    <div class="panel-heading">
      <h2 id="goal-heading">Goal</h2>
      <span class="panel-status" :class="{ reached: caseComplete }">{{ goalStatus }}</span>
    </div>
    <p class="objective" dir="auto">{{ objective }}</p>
    <p v-if="caseComplete && !session.completed" class="panel-note">
      This case still counts as complete. You can replay its goal in this session.
    </p>
  </section>

  <section
    :hidden="openPanel !== 'session'"
    id="session-details"
    class="title-panel"
    aria-labelledby="session-heading"
    tabindex="0"
  >
    <div class="panel-heading">
      <h2 id="session-heading">Session</h2>
      <button
        type="button"
        class="restart-session"
        title="Clears this session’s transcript and drafts. Campaign progress and mail stay saved."
        :disabled="busy"
        @click="emit('restart')"
      >
        Restart session
      </button>
    </div>
    <dl class="session-details">
      <div>
        <dt>Location</dt>
        <dd>
          <bdi>{{ session.host?.id ?? 'Local console' }}</bdi>
        </dd>
      </div>
      <div>
        <dt>Signed in as</dt>
        <dd>
          <bdi>{{ session.identity.user }}</bdi>
        </dd>
      </div>
      <div>
        <dt>Permissions</dt>
        <dd>
          <bdi>{{ permissionLabel }}</bdi>
        </dd>
      </div>
    </dl>
  </section>

  <section
    :hidden="openPanel !== 'progress'"
    id="progress-details"
    class="title-panel"
    aria-labelledby="progress-heading"
    tabindex="0"
  >
    <div class="panel-heading">
      <h2 id="progress-heading">Progress</h2>
    </div>
    <p v-if="campaignFinished" class="reached campaign-complete">
      All available scenarios complete
    </p>
    <dl v-if="hostStatus?.length" class="progress-details">
      <div v-for="({ label, value, description, reached }, index) in hostStatus" :key="index">
        <dt>
          <bdi>{{ label }}</bdi>
        </dt>
        <dd>
          <div class="check-result" :class="{ reached }">
            <Check v-if="reached" aria-hidden="true" />
            <CircleDashed v-else-if="reached === false" aria-hidden="true" />
            <bdi>{{ value }}</bdi>
          </div>
          <p v-if="description" class="panel-note" dir="auto">{{ description }}</p>
        </dd>
      </div>
    </dl>
    <p v-else-if="!campaignFinished" class="panel-note">
      {{ session.host ? 'No checks for this host.' : 'Connect to a host to see its checks.' }}
    </p>
  </section>
</template>

<style scoped>
.title-panel {
  --panel-surface: var(--raised);
  width: calc(100% - 2 * var(--space-2));
  max-height: min(calc(var(--app-height, 100dvh) * 0.34), 250px);
  margin-inline: auto var(--space-2);
  padding: var(--space-2) var(--space-3);
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--control);
  border-block-start-color: var(--accent);
  background: var(--panel-surface);
  box-shadow: 0 3px 0 var(--bg);
  overflow-wrap: anywhere;
  font: 14px/1.4 var(--sans);
}
.title-panel:focus-visible {
  outline-offset: -3px;
}
.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-block-end: var(--space-1);
}
.panel-heading h2,
.panel-status,
.title-panel dt {
  font: 12px/1.3 var(--mono);
}
.panel-heading h2 {
  font-weight: 700;
  text-transform: uppercase;
}
.panel-status,
.title-panel dt,
.panel-note {
  color: var(--muted);
}
.panel-note {
  font-size: 13px;
}
.objective + .panel-note {
  margin-block-start: var(--space-1);
}
.title-panel .reached {
  color: var(--accent);
}
.campaign-complete,
.check-result {
  font-weight: 600;
}
.session-details,
.progress-details {
  margin: 0;
}
.title-panel dd {
  margin: 0;
}
.session-details {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
}
.session-details dd {
  font: 13px/1.4 var(--mono);
}
.progress-details > div + div,
.campaign-complete + .progress-details {
  margin-block-start: var(--space-2);
  padding-block-start: var(--space-2);
  border-block-start: 1px solid var(--line);
}
.check-result {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
}
.check-result .lucide {
  --icon-size: 13px;
  align-self: center;
}
.restart-session {
  flex: none;
  min-height: var(--control-height);
  padding: 0 var(--space-2);
  background: transparent;
  color: var(--text);
  font-size: 12px;
}
@media (max-width: 600px) {
  .title-panel {
    width: calc(100% - 2 * var(--space-1));
    margin-inline-end: var(--space-1);
    padding-inline: var(--space-2);
    max-height: min(calc(var(--app-height, 100dvh) * 0.28), 186px);
  }
}
.short-viewport .title-panel {
  max-height: min(calc(var(--app-height, 100dvh) * 0.24), 108px);
  padding-block: var(--space-1);
}
@media (max-width: 830px) {
  .short-viewport .title-panel {
    max-height: min(
      calc(var(--app-height, 100dvh) * 0.24),
      108px,
      var(--title-detail-budget, 108px)
    );
  }
}
@media (max-width: 830px) and (pointer: coarse) {
  .title-panel {
    scrollbar-width: thin;
    scrollbar-color: var(--muted) transparent;
    scrollbar-gutter: stable;
    /* Keep a cue at an overflow edge when the touch scrollbar fades out. */
    background:
      linear-gradient(var(--panel-surface), var(--panel-surface)) right top / 4px 12px no-repeat
        local,
      linear-gradient(var(--panel-surface), var(--panel-surface)) right bottom / 4px 12px no-repeat
        local,
      linear-gradient(to bottom, var(--muted), transparent) right top / 4px 10px no-repeat scroll,
      linear-gradient(to top, var(--muted), transparent) right bottom / 4px 10px no-repeat scroll
        var(--panel-surface);
  }
}
@media (min-width: 831px) {
  .title-panel {
    position: absolute;
    z-index: 2;
    inset-block-start: 100%;
    inset-inline-end: var(--space-2);
    width: 480px;
    margin: 0;
    box-shadow: 0 4px 12px rgb(0 0 0 / 45%);
  }
}
</style>
