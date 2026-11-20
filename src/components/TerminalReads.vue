<script setup lang="ts">
import { ArrowUp, BookOpen } from '@lucide/vue'
import { nextTick, onMounted, onUnmounted, ref, useId } from 'vue'
import type { EarlierRead } from '../composables/useTerminalReads'

defineProps<{
  reads: EarlierRead[]
  canGoBack: boolean
  result?: { milestone: boolean }
  canReturnToRead: boolean
  triggerTarget?: HTMLElement
}>()
const emit = defineEmits<{ open: [EarlierRead, boolean]; back: []; result: [boolean] }>()
const trigger = ref<HTMLButtonElement>()
const menu = ref<HTMLElement>()
const opened = ref(false)
const menuId = useId()
const viewport = window.visualViewport

function positionMenu() {
  const anchor = trigger.value?.getBoundingClientRect()
  if (!menu.value || !anchor) return
  const top = viewport?.offsetTop ?? 0
  const below = top + (viewport?.height ?? innerHeight) - anchor.bottom
  const above = anchor.top - top
  const openAbove = above > below
  const width = Math.min(380, innerWidth - 22)
  menu.value.style.top = openAbove ? 'auto' : `${anchor.bottom + 3}px`
  menu.value.style.bottom = openAbove ? `${innerHeight - anchor.top + 3}px` : 'auto'
  menu.value.style.left = `${Math.min(Math.max(11, anchor.left), innerWidth - width - 11)}px`
  menu.value.style.maxHeight = `${Math.max(60, Math.max(above, below) - 8)}px`
}

function repositionMenu() {
  if (opened.value) void nextTick(positionMenu)
}

function close() {
  if (menu.value?.matches(':popover-open')) menu.value.hidePopover()
}

function closeWithEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return
  if (!menu.value?.matches(':popover-open')) return
  // A pointer can leave the editor focused. Close Reads before Escape edits that draft.
  event.preventDefault()
  event.stopPropagation()
  close()
}

onMounted(() => {
  window.addEventListener('keydown', closeWithEscape, true)
  window.addEventListener('resize', repositionMenu)
  viewport?.addEventListener('resize', repositionMenu)
  viewport?.addEventListener('scroll', repositionMenu)
})
onUnmounted(() => {
  window.removeEventListener('keydown', closeWithEscape, true)
  window.removeEventListener('resize', repositionMenu)
  viewport?.removeEventListener('resize', repositionMenu)
  viewport?.removeEventListener('scroll', repositionMenu)
})

function keepEditing(event: MouseEvent) {
  if (document.activeElement?.matches('.command-composer input, .command-composer textarea'))
    event.preventDefault()
}

function toggle(event: MouseEvent) {
  if (!menu.value) return
  if (menu.value.matches(':popover-open')) return close()
  positionMenu()
  menu.value.showPopover()
  if (event.detail === 0)
    (menu.value.querySelector('button') ?? menu.value).focus({ preventScroll: true })
}

function choose(read: EarlierRead, event: MouseEvent) {
  close()
  emit('open', read, event.detail === 0)
}

function back(event: MouseEvent) {
  emit('back')
  if (event.detail === 0) trigger.value?.focus({ preventScroll: true })
}

defineExpose({ close })
</script>

<template>
  <Teleport :to="triggerTarget ?? 'body'" :disabled="!triggerTarget">
    <slot />
    <button
      ref="trigger"
      type="button"
      :aria-controls="menuId"
      :aria-expanded="opened"
      aria-label="Earlier reads"
      title="Earlier reads"
      @mousedown="keepEditing"
      @click="toggle"
    >
      <BookOpen aria-hidden="true" /> Reads
    </button>
    <div
      :id="menuId"
      ref="menu"
      class="reads-menu"
      popover="auto"
      tabindex="-1"
      @toggle="opened = ($event as ToggleEvent).newState === 'open'"
    >
      <ul v-if="reads.length" aria-label="Earlier reads">
        <li v-for="read in reads" :key="read.key">
          <button
            type="button"
            class="read-choice"
            @mousedown="keepEditing"
            @click="choose(read, $event)"
          >
            <bdi>{{ read.label }}</bdi>
            <bdi class="read-source">{{ read.source }}</bdi>
          </button>
        </li>
      </ul>
      <p v-else class="reads-empty">Open a file or message to see it here.</p>
    </div>
  </Teleport>
  <button
    v-if="canGoBack"
    type="button"
    title="Return to the working position before opening earlier reads"
    @mousedown="keepEditing"
    @click="back"
  >
    Back
  </button>
  <button
    v-if="canReturnToRead || result"
    type="button"
    :class="{ 'result-milestone': !canReturnToRead && result?.milestone }"
    :title="canReturnToRead ? 'Return to the reading position' : 'Go to the latest command result'"
    @mousedown="keepEditing"
    @click="emit('result', $event.detail === 0)"
  >
    {{ canReturnToRead ? 'Back to read' : result?.milestone ? 'Milestone' : 'Result' }}
    <ArrowUp v-if="!canReturnToRead" aria-hidden="true" />
  </button>
</template>

<style scoped>
.reads-menu {
  position: fixed;
  right: auto;
  width: min(380px, calc(100vw - 22px));
  margin: 0;
  padding: 4px;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--control);
  color: var(--text);
  background: var(--surface);
  font: 13px/1.35 var(--sans);
}
.reads-menu ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.reads-menu .read-choice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 5px 7px;
  border: 0;
  background: transparent;
  text-align: start;
  overflow-wrap: anywhere;
  font: 13px/1.35 var(--mono);
}
.reads-menu .read-choice:focus-visible {
  outline-offset: -2px;
}
.reads-menu .read-choice:hover {
  background: var(--raised);
}
.read-source,
.reads-empty {
  color: var(--muted);
}
.read-source {
  font-size: 12px;
}
.reads-empty {
  padding: 5px 7px;
}
.result-milestone {
  --shortcut-border: var(--accent);
  color: var(--accent);
}
@media (max-width: 600px), (pointer: coarse) {
  .reads-menu .read-choice {
    min-height: 44px;
  }
}
</style>
