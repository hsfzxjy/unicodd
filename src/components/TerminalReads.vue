<script setup lang="ts">
import { BookCheck } from '@lucide/vue'
import { computed, nextTick, onMounted, onUnmounted, ref, useId } from 'vue'
import { displayedCommand } from '../composables/terminal-presentation'
import type { EarlierRead } from '../composables/useTerminalReads'
import type { Entry } from '../lib/workspace'

const props = defineProps<{
  reads: EarlierRead[]
  entries: Entry[]
  triggerTarget?: HTMLElement
}>()
const emit = defineEmits<{ open: [EarlierRead, boolean]; jump: [number, boolean] }>()
const trigger = ref<HTMLButtonElement>()
const menu = ref<HTMLElement>()
const opened = ref(false)
const showCommands = ref(false)
const commands = computed(() =>
  props.entries.filter((entry) => entry.echo !== undefined && !entry.waiting).reverse(),
)
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
  menu.value.style.bottom = openAbove ? `${innerHeight - anchor.top + 8}px` : 'auto'
  menu.value.style.left = `${Math.min(Math.max(11, anchor.left), innerWidth - width)}px`
  menu.value.style.maxHeight = `${Math.max(60, Math.max(above, below) - 8)}px`
}

function repositionMenu() {
  if (opened.value) void nextTick(positionMenu)
}

function close() {
  if (menu.value?.matches(':popover-open') || opened.value) menu.value?.hidePopover()
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

async function toggle(event: MouseEvent) {
  if (!menu.value) return
  if (menu.value.matches(':popover-open') || opened.value) return close()
  showCommands.value = false
  await nextTick()
  if (!menu.value) return
  positionMenu()
  menu.value.showPopover()
  menu.value.scrollTop = 0
  if (event.detail === 0)
    (menu.value.querySelector('button') ?? menu.value).focus({ preventScroll: true })
}

async function switchList(event: MouseEvent) {
  showCommands.value = !showCommands.value
  await nextTick()
  if (!menu.value) return
  menu.value.scrollTop = 0
  if (event.detail === 0) menu.value.querySelector('button')?.focus({ preventScroll: true })
}

function choose(read: EarlierRead, event: MouseEvent) {
  close()
  emit('open', read, event.detail === 0)
}

function chooseCommand(id: number, event: MouseEvent) {
  close()
  emit('jump', id, event.detail === 0)
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
      aria-description="Browse previously read resources and command output"
      title="Earlier reads and command output"
      @mousedown="keepEditing"
      @click="toggle"
    >
      <BookCheck aria-hidden="true" />
    </button>
    <div
      :id="menuId"
      ref="menu"
      class="reads-menu"
      popover="auto"
      tabindex="-1"
      @toggle="opened = ($event as ToggleEvent).newState === 'open'"
    >
      <ul v-if="opened && showCommands" aria-label="Command output, newest first">
        <li v-for="entry in commands" :key="entry.id">
          <button
            type="button"
            class="read-choice command-choice"
            @mousedown="keepEditing"
            @click="chooseCommand(entry.id, $event)"
          >
            <bdi>{{ displayedCommand(entry) }}</bdi>
            <bdi class="transcript-detail">{{ entry.connected ? '@' : '' }}{{ entry.prompt }}</bdi>
          </button>
        </li>
      </ul>
      <ul v-else-if="reads.length" aria-label="Earlier reads">
        <li v-for="read in reads" :key="read.key">
          <button
            type="button"
            class="read-choice"
            @mousedown="keepEditing"
            @click="choose(read, $event)"
          >
            <bdi>{{ read.label }}</bdi>
            <bdi class="transcript-detail">{{ read.source }}</bdi>
          </button>
        </li>
      </ul>
      <p v-else class="reads-empty transcript-detail">Open a file or message to see it here.</p>
      <button
        v-if="commands.length"
        type="button"
        class="switch-list"
        @mousedown="keepEditing"
        @click="switchList"
      >
        {{ showCommands ? 'Back to earlier reads' : 'Command output' }}
      </button>
    </div>
  </Teleport>
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
  border-block-start-color: var(--accent);
  color: var(--text);
  background: var(--surface);
  font: 13px/1.35 var(--sans);
}
.reads-menu ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.reads-menu li + li {
  box-shadow: inset 0 1px var(--line);
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
}
.reads-menu .read-choice:focus-visible {
  outline-offset: -2px;
}
.reads-menu .read-choice:hover {
  background: var(--raised);
}
.command-choice bdi:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.command-choice .transcript-detail {
  flex-shrink: 0;
}
.reads-menu .switch-list {
  position: sticky;
  bottom: 0;
  width: 100%;
  min-height: var(--control-height);
  background: var(--surface);
  color: var(--accent);
}
.reads-empty {
  padding: 5px 7px;
}
@media (max-width: 600px), (pointer: coarse) {
  .reads-menu :is(.read-choice, .switch-list) {
    min-height: 44px;
  }
}
</style>
