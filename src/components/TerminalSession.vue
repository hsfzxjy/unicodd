<script setup lang="ts">
import { ref } from 'vue'
import type { createRuntime, Session } from '../lib/runtime'

defineProps<{
  sessionExpanded: boolean
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
const sessionPanel = ref<HTMLElement>()

function reveal(section: string, shortViewport: boolean) {
  const panel = sessionPanel.value
  const scroll = panel?.parentElement
  if (!panel || !scroll) return
  const target =
    section === 'campaign' ||
    section.startsWith('host-') ||
    (section === 'session' && shortViewport)
      ? panel.querySelector<HTMLElement>(`[data-status-key="${section}"]`)
      : null
  scroll.scrollTop = target
    ? target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 6
    : 0
}

defineExpose({ reveal })
</script>

<template>
  <aside
    v-show="sessionExpanded"
    id="session-details"
    ref="sessionPanel"
    class="session-layer"
    aria-label="Session context"
  >
    <div class="objective">
      <div class="objective-heading">
        <h2>Goal</h2>
        <span :class="{ 'objective-done': caseComplete }">{{ goalStatus }}</span>
      </div>
      <p dir="auto">{{ objective }}</p>
      <p v-if="caseComplete && !session.completed" class="muted">
        This case still counts as complete. You can replay its goal in this session.
      </p>
      <p v-if="campaignFinished" class="objective-done" data-status-key="campaign">
        All available scenarios complete
      </p>
    </div>
    <div class="session-identity" data-status-key="session">
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
        <div v-if="session.identity.user !== permissionLabel">
          <dt>Permissions</dt>
          <dd>
            <bdi>{{ permissionLabel }}</bdi>
          </dd>
        </div>
      </dl>
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
    <dl
      v-if="hostStatus?.length"
      class="session-details host-details"
      data-status-key="host-summary"
    >
      <div
        v-for="({ label, value, description }, index) in hostStatus"
        :key="index"
        :data-status-key="'host-' + index"
        :class="{ 'status-explained': description }"
      >
        <dt>
          <bdi>{{ label }}</bdi>
        </dt>
        <dd>
          <bdi>{{ value }}</bdi>
          <span v-if="description" class="host-status-description" dir="auto">{{
            description
          }}</span>
        </dd>
      </div>
    </dl>
  </aside>
</template>

<style scoped>
.session-layer {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  align-items: start;
  column-gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--control);
  background: #1b2931;
  font: 13px/1.4 var(--sans);
  overflow-wrap: anywhere;
}
.session-identity {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  justify-content: space-between;
  border-inline-start: 1px solid var(--control);
  padding-inline-start: var(--space-3);
}
.session-details {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  margin: 0;
}
.session-details dt {
  color: var(--muted);
  font-size: 11px;
}
.session-details dd {
  margin: 0;
  font-weight: 550;
}
.restart-session {
  flex: none;
  min-height: var(--control-height);
  padding-inline: var(--space-2);
  border-color: transparent;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.host-details {
  grid-column: 1 / -1;
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--control);
  column-gap: var(--space-3);
}
.host-details .status-explained {
  flex-basis: 100%;
}
.host-status-description {
  display: block;
  color: var(--muted);
  font-weight: 400;
}
.objective-heading {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}
.objective-heading h2 {
  font-size: 13px;
}
.objective-heading span {
  color: var(--muted);
  font-size: 12px;
}
.objective p + p {
  margin-top: var(--space-1);
}
.objective .objective-done {
  color: var(--accent);
}
@media (max-width: 830px) {
  .session-layer {
    grid-template-columns: minmax(0, 1fr);
    row-gap: var(--compact-gap);
    padding: var(--compact-gap) var(--space-2);
    line-height: 1.35;
  }
  .objective-heading,
  .objective-heading h2,
  .objective > p:first-of-type {
    display: inline;
  }
  .objective-heading :is(h2, span) {
    margin-inline-end: var(--compact-gap);
  }
  .objective-heading span::after {
    content: ' ·';
  }
  .session-identity {
    border-inline-start: 0;
    border-top: 1px solid var(--line);
    padding-inline-start: 0;
    gap: var(--compact-gap);
  }
  .session-details {
    gap: var(--compact-tight) var(--space-2);
  }
  .session-details :is(dt, dd) {
    display: inline;
    line-height: var(--compact-leading);
  }
  .session-details dd {
    margin-inline-start: var(--compact-gap);
  }
  .restart-session {
    min-height: var(--compact-control);
    padding-block: var(--compact-inset);
  }
  .host-details {
    margin: 0;
    padding-block-start: var(--compact-inset);
  }
}
@media (min-width: 831px) {
  .short-viewport .session-layer {
    padding-block: var(--space-1);
  }
}
</style>
