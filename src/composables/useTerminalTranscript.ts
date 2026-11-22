import { nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch, type Ref } from 'vue'
import { progressResult, useTerminalReads, type TranscriptResult } from './useTerminalReads'
import { unpairedSurrogate } from '../lib/unicode'
import type { Entry, TerminalView } from '../lib/workspace'

const outputSelectors = {
  inspection: '.inspection',
  mail: '.terminal-mail',
  file: '.terminal-file',
  report: '.terminal-report',
  list: '.terminal-list',
  help: '.command-help',
}

export function sameResult(a: TranscriptResult | undefined, b: TranscriptResult) {
  return a?.id === b.id && a.kind === b.kind
}

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
  const awayFromEnd = ref(false)
  const freshProgress = shallowRef<TranscriptResult>()
  const offscreenProgress = shallowRef<TranscriptResult>()
  const presentation = shallowRef<{
    result: TranscriptResult
    anchor: HTMLElement
    target: 'band' | 'jump'
  }>()
  let pendingProgress: TranscriptResult | undefined
  let settlementFrame = 0
  const collapsedAnnouncement = ref('')
  const selectedScalar = ref<string>()
  const collapsed = reactive(new Set<number>())
  let holdScrollSpace = false
  const {
    reads,
    reading,
    archived,
    result,
    resultReturn,
    readingResource,
    openEntry,
    openRead,
    remember,
    back,
    backToRead,
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
    revealResult,
    focusTranscript,
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

  function moveTranscript(top: number, hold = false) {
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
    holdScrollSpace = hold
    box.scrollTop = top
  }

  function scrollToEnd(keyboard = false) {
    const box = scroll.value
    if (box) {
      box.style.removeProperty(scrollSpace)
      box.scrollTop = box.scrollHeight
    }
    following.value = !reading.value
    holdScrollSpace = false
    awayFromEnd.value = false
    if (keyboard) {
      const last = box?.lastElementChild as HTMLElement | undefined
      if (box && last && last.getBoundingClientRect().top >= box.getBoundingClientRect().top)
        last.focus({ preventScroll: true })
      else focusTranscript()
    }
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
      const remaining = box.scrollHeight - box.scrollTop - box.clientHeight
      const reserved = Number.parseFloat(box.style.getPropertyValue(scrollSpace)) || 0
      if (!reserved) holdScrollSpace = false
      awayFromEnd.value = remaining - reserved > 1
      following.value = !reading.value && !holdScrollSpace && remaining < (atOpening() ? 1 : 28)
    }
    if (!pendingProgress) measureProgress()
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
    holdScrollSpace = false
    cancelAnimationFrame(settlementFrame)
    pendingProgress = presentation.value = undefined
    freshProgress.value = offscreenProgress.value = undefined
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

  let resizeFrame = 0
  const transcriptResize = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      if (following.value && !atOpening()) scrollToEnd()
      trackScroll()
    })
  })
  onMounted(() => {
    document.addEventListener('selectionchange', readResourceSelection)
    if (scroll.value) transcriptResize.observe(scroll.value)
  })
  onUnmounted(() => {
    document.removeEventListener('selectionchange', readResourceSelection)
    transcriptResize.disconnect()
    cancelAnimationFrame(resizeFrame)
    cancelAnimationFrame(settlementFrame)
  })

  watch(
    entries,
    (entries, previous) => {
      if (presentation.value && !entries.some(({ id }) => id === presentation.value?.result.id))
        presentation.value = undefined
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
      if (last && !last.waiting && (last.id !== prior?.id || prior?.waiting)) {
        freshProgress.value = progressResult(last)
        offscreenProgress.value = undefined
        pendingProgress = freshProgress.value
        // The settled command can still reveal the start of its file or report this tick.
        cancelAnimationFrame(settlementFrame)
        settlementFrame = requestAnimationFrame(() => {
          const pending = pendingProgress
          pendingProgress = undefined
          if (pending) measureProgress(pending)
          trackScroll()
        })
      }
    },
    { flush: 'post' },
  )

  function findEntry(id: number) {
    return scroll.value?.querySelector<HTMLElement>(`[data-entry-id="${id}"]`)
  }

  function resultAnchor(target: TranscriptResult) {
    const entry = findEntry(target.id)
    const selector = {
      completion: '.progress-band[data-scope="scenario"] h3',
      milestone: '.progress-band[data-scope="subobjective"] h3',
      diagnostic: '.terminal-line.error',
      report: '.entry-output > :first-child',
      inspection: outputSelectors.inspection,
    }[target.kind]
    return entry?.querySelector<HTMLElement>(selector) ?? entry
  }

  function progressVisible(target: TranscriptResult, anchor: HTMLElement) {
    const box = scroll.value
    const band = anchor.closest('.progress-band')
    if (!box?.contains(anchor) || !band || collapsed.has(target.id)) return false
    const handoff = band.nextElementSibling?.querySelector('button')
    const viewport = box.getBoundingClientRect()
    return (
      anchor.getBoundingClientRect().top >= viewport.top &&
      (handoff ?? band).getBoundingClientRect().bottom <= viewport.bottom
    )
  }

  function measureProgress(pending?: TranscriptResult) {
    const target = freshProgress.value
    if (!target || (reading.value && !pending)) return
    const anchor = resultAnchor(target)
    if (!anchor?.closest('.progress-band')) return
    const visible = progressVisible(target, anchor)
    if (!reading.value) {
      if (visible) freshProgress.value = offscreenProgress.value = undefined
      else offscreenProgress.value = target
    }
    if (
      pending === target &&
      (!reading.value || (sameResult(result.value, target) && !resultReturn.value))
    )
      presentation.value = { result: target, anchor, target: visible ? 'band' : 'jump' }
  }

  function consumeProgress(target: TranscriptResult) {
    if (sameResult(pendingProgress, target)) pendingProgress = undefined
    if (sameResult(presentation.value?.result, target)) presentation.value = undefined
  }

  async function revealResult(target: TranscriptResult, keyboard: boolean) {
    const box = scroll.value
    const anchor = resultAnchor(target)
    if (!box || !anchor) return
    consumeProgress(target)
    if (freshProgress.value?.id === target.id)
      freshProgress.value = offscreenProgress.value = undefined
    const position = () =>
      moveTranscript(
        box.scrollTop + anchor.getBoundingClientRect().top - box.getBoundingClientRect().top - 6,
        true,
      )
    position()
    trackScroll()
    // Removing the action can grow the transcript and clamp the jump before it paints.
    await nextTick()
    if (!anchor.isConnected) return
    position()
    trackScroll()
    if (keyboard) anchor.focus({ preventScroll: true })
  }

  async function showProgress(keyboard: boolean) {
    const target = offscreenProgress.value
    if (!target) return
    collapsed.delete(target.id)
    await nextTick()
    revealResult(target, keyboard)
  }

  function revealOutput(
    kind: keyof typeof outputSelectors,
    focus: boolean,
    followOnly = false,
    fromComposer = false,
  ) {
    if (reading.value && (kind === 'report' || kind === 'inspection')) {
      if (!fromComposer && !followOnly && result.value?.kind === 'inspection')
        void showResult(focus)
      return
    }
    if (followOnly && !following.value) return
    const entry = entries().at(-1)
    if (!entry || collapsed.has(entry.id)) return
    const box = scroll.value
    const last = box?.lastElementChild
    if (!box || !last) return
    const latest = last.querySelector<HTMLElement>(outputSelectors[kind])
    if (!latest) return
    remember()
    const output = latest.closest<HTMLElement>('.entry-output') ?? latest
    const start = kind === 'report' ? output : latest
    const top = start.getBoundingClientRect().top
    if (output.getBoundingClientRect().bottom - top + 12 > box.clientHeight) {
      const viewport = box.getBoundingClientRect()
      box.scrollTop += top - viewport.top - 6
      trackScroll()
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
    awayFromEnd,
    offscreenProgress,
    presentation,
    progressVisible,
    consumeProgress,
    collapsedAnnouncement,
    selectedScalar,
    collapsed,
    reads,
    reading,
    archived,
    result,
    resultReturn,
    readingResource,
    openEntry,
    openRead,
    back,
    backToRead,
    showResult,
    showProgress,
    latest,
    toggleOutput,
    trackScroll,
    saveView,
    restoreView,
    revealOutput,
    focusTranscript,
  }
}
