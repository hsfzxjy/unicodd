import { nextTick, onMounted, onUnmounted, reactive, ref, watch, type Ref } from 'vue'
import { useTerminalReads } from './useTerminalReads'
import { unpairedSurrogate } from '../lib/unicode'
import type { Entry, TerminalView } from '../lib/workspace'

export function useTerminalTranscript({
  entries,
  scroll,
  frame,
  closeReads,
  change,
}: {
  entries: () => Entry[]
  scroll: Ref<HTMLDivElement | undefined>
  frame: Ref<HTMLElement | undefined>
  closeReads: () => void
  change: () => void
}) {
  const scrollSpace = '--transcript-scroll-space'
  const following = ref(true)
  const unseenProgress = ref(false)
  const collapsedAnnouncement = ref('')
  const selectedScalar = ref<string>()
  const collapsed = reactive(new Set<number>())
  const {
    reads,
    reading,
    archived,
    result,
    resultReturn,
    openRead,
    remember,
    back,
    showResult,
    latest,
    reset: resetReads,
    workingPosition,
  } = useTerminalReads({
    entries,
    scroll,
    following,
    expand: (id) => collapsed.delete(id),
    move: moveTranscript,
    followLatest: scrollToEnd,
    change,
  })

  async function toggleOutput(id: number) {
    const box = scroll.value
    const top = box?.scrollTop ?? 0
    if (collapsed.has(id)) collapsed.delete(id)
    else collapsed.add(id)
    await nextTick()
    if (box && box === scroll.value) moveTranscript(top)
    trackScroll()
    readResourceSelection()
  }

  function moveTranscript(top: number) {
    const box = scroll.value
    if (!box) return
    const last = box.lastElementChild
    const end = last
      ? last.getBoundingClientRect().bottom -
        box.getBoundingClientRect().top +
        box.scrollTop +
        Number.parseFloat(getComputedStyle(box).paddingBottom)
      : 0
    // Reserve space for a deliberate position near the end, even after collapsing output.
    const space = Math.ceil(top + box.clientHeight - end)
    if (last && top > 0 && space > 0) box.style.setProperty(scrollSpace, `${space}px`)
    else box.style.removeProperty(scrollSpace)
    box.scrollTop = top
  }

  function scrollToEnd() {
    const box = scroll.value
    if (box) {
      box.style.removeProperty(scrollSpace)
      box.scrollTop = box.scrollHeight
    }
    following.value = !reading.value
    unseenProgress.value = false
  }

  function atOpening() {
    const transcript = entries()
    return transcript.length === 1 && transcript[0].id === 0 && scroll.value?.scrollTop === 0
  }

  function trackScroll() {
    const box = scroll.value
    if (box) {
      const space = Number.parseFloat(box.style.getPropertyValue(scrollSpace))
      const distance = box.scrollHeight - box.scrollTop - box.clientHeight
      if (space && (box.scrollTop === 0 || distance >= space)) box.style.removeProperty(scrollSpace)
      following.value =
        !reading.value &&
        box.scrollHeight - box.scrollTop - box.clientHeight < (atOpening() ? 1 : 28)
    }
    if (following.value) unseenProgress.value = false
    change()
  }

  function saveView(): TerminalView {
    const working = workingPosition()
    return {
      collapsed: [...collapsed],
      scrollTop: working?.scrollTop ?? scroll.value?.scrollTop ?? 0,
      following: working?.following ?? following.value,
    }
  }

  function restoreView(view?: TerminalView) {
    closeReads()
    resetReads()
    collapsed.clear()
    if (Array.isArray(view?.collapsed))
      for (const id of view.collapsed)
        if (entries().some((entry) => entry.id === id)) collapsed.add(id)
    following.value = view?.following !== false
    void nextTick(() => {
      if (!scroll.value) return
      scroll.value.style.removeProperty(scrollSpace)
      const transcript = entries()
      const opening = !view?.scrollTop && transcript.length === 1 && transcript[0].id === 0
      if (opening || (view?.following === false && Number.isFinite(view.scrollTop))) {
        scroll.value.scrollTop = view?.scrollTop ?? 0
        trackScroll()
      } else scrollToEnd()
    })
  }

  function readResourceSelection() {
    const selection = window.getSelection()
    const node = (node: Node | null | undefined) =>
      node instanceof Element ? node : node?.parentElement
    const start = node(selection?.anchorNode)?.closest('[data-resource-text]')
    const end = node(selection?.focusNode)?.closest('[data-resource-text]')
    const text = selection?.toString() ?? ''
    selectedScalar.value =
      start &&
      start === end &&
      scroll.value?.contains(start) &&
      start.getClientRects().length &&
      Array.from(text).length === 1 &&
      unpairedSurrogate(text) === undefined
        ? text
        : undefined
  }

  const transcriptResize = new ResizeObserver(() => {
    if (atOpening()) {
      requestAnimationFrame(() => {
        if (atOpening()) trackScroll()
      })
    } else if (following.value) scrollToEnd()
  })
  onMounted(() => {
    document.addEventListener('selectionchange', readResourceSelection)
    if (scroll.value) transcriptResize.observe(scroll.value)
  })
  onUnmounted(() => {
    document.removeEventListener('selectionchange', readResourceSelection)
    transcriptResize.disconnect()
  })

  watch(
    entries,
    (entries, previous) => {
      for (const id of collapsed) {
        if (!entries.some((entry) => entry.id === id)) collapsed.delete(id)
      }
      const last = entries.at(-1)
      const prior = previous.at(-1)
      const progress = last?.freshProgress
        ? last.output
            .slice(last.id === prior?.id ? prior.output.length : 0)
            .flatMap((row) => ('progress' in row && row.progress ? [row.progress] : []))
        : []
      if (last && progress.length && collapsed.has(last.id)) {
        collapsedAnnouncement.value = progress
          .map(({ title, text }) => title + '. ' + text)
          .join(' ')
      } else if (last?.id !== prior?.id) {
        collapsedAnnouncement.value = ''
      }
      const firstCommand = prior?.id === 0 && last && last.id !== 0 && scroll.value?.scrollTop === 0
      if (following.value || firstCommand) scrollToEnd()
      else if (progress.length) unseenProgress.value = true
    },
    { flush: 'post' },
  )

  function revealOutput(
    kind: 'inspection' | 'mail' | 'file' | 'report' | 'list',
    focus: boolean,
    followOnly = false,
  ) {
    if (reading.value && kind === 'report' && !focus) return
    if (followOnly && !following.value) return
    const entry = entries().at(-1)
    if (!entry || collapsed.has(entry.id)) return
    const box = scroll.value
    const selector = kind === 'inspection' ? '.inspection' : '.terminal-' + kind
    const latest = box?.lastElementChild?.querySelector<HTMLElement>(selector)
    if (!box || !latest) return
    remember()
    const start =
      kind === 'report' ? (latest.closest<HTMLElement>('.entry-output') ?? latest) : latest
    if (start.offsetHeight + 12 > box.clientHeight) {
      box.scrollTop += start.getBoundingClientRect().top - box.getBoundingClientRect().top - 6
      trackScroll()
      if (entry.freshProgress) {
        const band = box.lastElementChild?.querySelector('.progress-band')
        unseenProgress.value = Boolean(
          band && band.getBoundingClientRect().bottom > box.getBoundingClientRect().bottom,
        )
      }
    } else {
      scrollToEnd()
    }
    if (focus) {
      frame.value?.scrollIntoView({ block: 'nearest' })
      latest.focus({ preventScroll: true })
    }
  }

  function focusTranscript() {
    scroll.value?.focus({ preventScroll: true })
  }

  return {
    following,
    unseenProgress,
    collapsedAnnouncement,
    selectedScalar,
    collapsed,
    reads,
    reading,
    archived,
    result,
    resultReturn,
    openRead,
    back,
    showResult,
    latest,
    toggleOutput,
    trackScroll,
    saveView,
    restoreView,
    revealOutput,
    focusTranscript,
  }
}
