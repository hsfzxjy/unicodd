<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { commandRegistry, type CommandName } from '../lib/commands'
import type { OperationBinding } from '../lib/scenario'

const props = defineProps<{
  id: string
  anchor?: HTMLElement
  selected?: CommandName
  suggestions: string[]
  operations: readonly OperationBinding[]
  composing: boolean
}>()
const emit = defineEmits<{ select: [CommandName]; unwrap: []; escape: [] }>()
const menu = ref<HTMLElement>()
const available = computed(() => {
  const names = new Set(props.suggestions)
  const operations = new Set<string>(props.operations.map(({ command }) => command))
  const local = props.selected?.startsWith('local ')
  const priority = (name: CommandName) => {
    if (local && name.startsWith('local ')) return 2
    return operations.has(name) ? 1 : 0
  }
  return commandRegistry
    .filter((command) => names.has(command.name))
    .sort((a, b) => priority(b.name) - priority(a.name))
})
const menuIndex = ref(
  Math.max(
    0,
    available.value.findIndex(({ name }) => name === props.selected),
  ),
)

const menuResize = new ResizeObserver(fitMenu)

function fitMenu() {
  const composer = props.anchor
  if (!menu.value || !composer) return
  const viewportTop = window.visualViewport?.offsetTop ?? 0
  const space = composer.getBoundingClientRect().top - viewportTop - 8
  menu.value.style.setProperty('--menu-space', `${Math.max(0, space)}px`)
}

function focusItem() {
  menu.value?.querySelectorAll<HTMLButtonElement>('button')[menuIndex.value]?.focus()
}

onMounted(() => {
  if (props.anchor) menuResize.observe(props.anchor)
  menuResize.observe(document.documentElement)
  window.visualViewport?.addEventListener('resize', fitMenu)
  window.visualViewport?.addEventListener('scroll', fitMenu)
  fitMenu()
  focusItem()
})
onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener('resize', fitMenu)
  window.visualViewport?.removeEventListener('scroll', fitMenu)
  menuResize.disconnect()
})

function menuKey(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229 || props.composing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('escape')
    return
  }
  const count = available.value.length + Number(Boolean(props.selected))
  if (!count) return
  if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    menuIndex.value =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? count - 1
          : (menuIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
    focusItem()
  }
}
</script>

<template>
  <div
    :id="id"
    ref="menu"
    class="command-menu"
    role="menu"
    aria-label="Commands"
    @keydown="menuKey"
  >
    <button
      v-for="(command, index) in available"
      :key="command.name"
      type="button"
      role="menuitemradio"
      :aria-checked="selected === command.name"
      :tabindex="index === menuIndex ? 0 : -1"
      @click="emit('select', command.name)"
    >
      <span>{{ command.usage }}</span
      ><span class="meta">{{ command.description }}</span>
    </button>
    <button
      v-if="selected"
      type="button"
      role="menuitem"
      :tabindex="menuIndex === available.length ? 0 : -1"
      @click="emit('unwrap')"
    >
      Edit command name…
    </button>
  </div>
</template>

<style scoped>
.command-menu {
  position: absolute;
  z-index: 3;
  inset-inline: 0;
  bottom: calc(100% + var(--space-1));
  max-width: 540px;
  max-height: min(50dvh, 390px, var(--menu-space, 100dvh));
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--control);
  border-block-start-color: var(--accent);
  padding: 3px;
  background: var(--surface);
}
.command-menu button {
  display: grid;
  grid-template-columns: 16ch minmax(0, 1fr);
  gap: 8px;
  text-align: start;
  width: 100%;
  min-height: 32px;
  padding: 4px 6px;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.command-menu button[aria-checked='true'] {
  color: var(--accent);
  background: var(--raised);
}
.command-menu button:focus {
  outline-offset: -2px;
}
.command-menu button[role='menuitem'] {
  display: block;
  border-top: 1px solid var(--line);
}
.command-menu .meta {
  font-size: 11px;
}
@media (max-width: 600px), (pointer: coarse) {
  .command-menu button {
    min-height: var(--touch-height);
  }
  .command-menu button {
    grid-template-columns: 11ch minmax(0, 1fr);
  }
}
</style>
