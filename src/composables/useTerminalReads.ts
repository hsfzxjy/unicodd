import { computed, nextTick, shallowRef, watch, type Ref } from 'vue'
import type { Output } from '../lib/runtime'
import type { Entry } from '../lib/workspace'

export type ReadOutput = Extract<Output, { kind: 'file' } | { kind: 'mail' }>

export interface EarlierRead {
  key: string
  entry: number
  source: string
  label: string
  output: ReadOutput
  report?: Extract<Output, { kind: 'report' }>
  offset: number
}

interface Position {
  top: number
  entry?: string
  resource?: boolean
  offset: number
  following: boolean
}

interface Transcript {
  entries: () => Entry[]
  scroll: Ref<HTMLDivElement | undefined>
  following: Ref<boolean>
  expand: (id: number) => void
  move: (top: number, hold?: boolean) => void
  followLatest: (keyboard?: boolean) => void
  revealResult: (result: TranscriptResult, keyboard: boolean) => void
  focusTranscript: () => void
  change: () => void
}

const inset = 6

export type TranscriptResult = {
  id: number
  kind: 'completion' | 'milestone' | 'diagnostic' | 'report' | 'inspection'
}

export function progressResult(entry: Entry): TranscriptResult | undefined {
  if (!entry.freshProgress || entry.waiting) return
  const bands = entry.output.flatMap((row) =>
    'progress' in row && row.progress ? [row.progress] : [],
  )
  if (bands.length)
    return {
      id: entry.id,
      kind: bands.some(({ scope }) => scope === 'scenario') ? 'completion' : 'milestone',
    }
}

export function useTerminalReads({
  entries,
  scroll,
  following,
  expand,
  move,
  followLatest,
  revealResult,
  focusTranscript,
  change,
}: Transcript) {
  const bySource = new Map<string, EarlierRead>()
  const reads = shallowRef<EarlierRead[]>([])
  const selected = shallowRef<EarlierRead>()
  const origin = shallowRef<Position>()
  const resultReturn = shallowRef<Position>()
  let openedAfter = 0
  let indexedThrough = 0
  let navigation = 0

  const reading = computed(() => Boolean(origin.value))
  const archived = computed(() => {
    const read = selected.value
    return read && !entries().some(({ id }) => id === read.entry) ? read : undefined
  })
  const result = computed<TranscriptResult | undefined>(() => {
    const entry = entries().at(-1)
    if (!reading.value || !entry || entry.waiting || entry.id <= openedAfter) return
    const progress = progressResult(entry)
    if (progress) return progress
    if (entry.output.some((row) => row.kind === 'error'))
      return { id: entry.id, kind: 'diagnostic' }
    const experiment = entry.output.find(
      (row) => row.kind === 'report' || row.kind === 'inspection',
    )
    if (experiment) return { id: entry.id, kind: experiment.kind }
  })

  // Keep one snapshot per source in the open workspace. Pending responses and directory
  // links never supply a read, and a snapshot is independent of the 80-entry scrollback.
  function indexReads(history: Entry[]) {
    let changed = false
    for (const entry of history) {
      if (entry.id <= indexedThrough || entry.waiting) continue
      indexedThrough = entry.id
      for (const output of entry.output) {
        if (output.kind !== 'file' && output.kind !== 'mail') continue
        const source = entry.connected ? '@' + entry.prompt : 'local'
        const resource =
          output.path ?? (output.kind === 'mail' ? output.messages.map(({ id }) => id) : '')
        const label =
          output.path ?? (output.kind === 'mail' ? (output.messages[0]?.subject ?? '') : '')
        const key = JSON.stringify([source, output.kind, resource])
        bySource.delete(key)
        const report =
          output.kind === 'file' ? entry.output.find((row) => row.kind === 'report') : undefined
        bySource.set(key, { key, entry: entry.id, source, label, output, report, offset: 0 })
        changed = true
      }
    }
    if (changed) reads.value = [...bySource.values()].reverse()
  }

  function findEntry(id: string | number) {
    return scroll.value?.querySelector<HTMLElement>(`[data-entry-id="${id}"]`)
  }

  function findRead(read: EarlierRead) {
    return findEntry(read.entry)?.querySelector<HTMLElement>('.terminal-file, .terminal-mail')
  }

  function offset(el: HTMLElement) {
    return el.getBoundingClientRect().top - (scroll.value?.getBoundingClientRect().top ?? 0)
  }

  function visibleOffset(el: HTMLElement) {
    const top = offset(el)
    const height = el.offsetHeight
    return height && top < (scroll.value?.clientHeight ?? 0) && top + height > 0 ? top : undefined
  }

  function moveTo(el: HTMLElement, at: number, hold?: boolean) {
    if (scroll.value) move(scroll.value.scrollTop + offset(el) - at, hold)
  }

  function capture(read?: EarlierRead): Position {
    const box = scroll.value
    const top = box?.scrollTop ?? 0
    const resource = read && findRead(read)
    const resourceTop = resource ? visibleOffset(resource) : undefined
    if (read && resourceTop !== undefined) {
      return {
        top,
        entry: String(read.entry),
        resource: true,
        offset: resourceTop,
        following: following.value,
      }
    }
    const entry = Array.from(box?.querySelectorAll<HTMLElement>('[data-entry-id]') ?? []).find(
      (el) => visibleOffset(el) !== undefined,
    )
    return {
      top,
      entry: entry?.dataset.entryId,
      offset: entry ? offset(entry) : 0,
      following: following.value,
    }
  }

  function restore(place: Position, hold?: boolean) {
    const entry = place.entry === undefined ? undefined : findEntry(place.entry)
    const el = place.resource
      ? entry?.querySelector<HTMLElement>('.terminal-file, .terminal-mail')
      : entry
    if (el) moveTo(el, place.offset, hold)
    else move(place.entry === undefined ? place.top : 0, hold)
  }

  function remember() {
    const read = selected.value
    if (!read || resultReturn.value) return
    const el = findRead(read)
    const top = el ? visibleOffset(el) : undefined
    if (top !== undefined) read.offset = Math.max(0, inset - top)
  }

  watch(
    entries,
    (history, previous = []) => {
      const read = selected.value
      // Capture the live passage before its original row is replaced by the earlier snapshot.
      const evicted =
        read &&
        previous.some(({ id }) => id === read.entry) &&
        !history.some(({ id }) => id === read.entry)
      if (evicted) {
        const el = findRead(read)
        const top = el ? visibleOffset(el) : undefined
        const request = navigation
        if (top !== undefined)
          void nextTick(() => {
            if (request !== navigation) return
            const replacement = findRead(read)
            if (replacement) moveTo(replacement, top)
          })
      }
      indexReads(history)
    },
    { immediate: true },
  )

  async function openRead(read: EarlierRead, keyboard: boolean) {
    const request = ++navigation
    remember()
    if (!origin.value) {
      origin.value = capture()
      const history = entries()
      const latest = history.at(-1)
      openedAfter = (latest?.waiting ? history.at(-2)?.id : latest?.id) ?? 0
    }
    resultReturn.value = undefined
    selected.value = read
    following.value = false
    expand(read.entry)
    await nextTick()
    if (request !== navigation) return
    const el = findRead(read)
    const start = archived.value && !read.offset ? findEntry(read.entry) : el
    if (start) moveTo(start, inset - read.offset)
    if (keyboard) el?.focus({ preventScroll: true })
    change()
  }

  function dismiss() {
    navigation++
    origin.value = undefined
    selected.value = undefined
    resultReturn.value = undefined
  }

  async function back(keyboard: boolean) {
    const place = origin.value
    if (!place) return
    remember()
    dismiss()
    const request = navigation
    await nextTick()
    if (request !== navigation) return
    if (place.following) followLatest()
    else {
      restore(place, true)
      following.value = false
    }
    if (keyboard) focusTranscript()
    change()
  }

  async function backToRead(keyboard: boolean) {
    const request = ++navigation
    const place = resultReturn.value
    if (!place) return
    resultReturn.value = undefined
    await nextTick()
    if (request !== navigation) return
    const read = selected.value
    const resource = read && findRead(read)
    if (resource && place.resource) moveTo(resource, place.offset)
    else restore(place)
    if (keyboard) {
      if (resource && visibleOffset(resource) !== undefined) resource.focus({ preventScroll: true })
      else focusTranscript()
    }
    change()
  }

  async function showResult(keyboard: boolean) {
    const target = result.value
    if (!target) return
    const request = ++navigation
    if (!resultReturn.value) {
      remember()
      resultReturn.value = capture(selected.value)
    }
    expand(target.id)
    await nextTick()
    if (request === navigation && entries().some(({ id }) => id === target.id))
      revealResult(target, keyboard)
  }

  async function latest(keyboard: boolean) {
    if (reading.value) {
      remember()
      dismiss()
      await nextTick()
    }
    followLatest(keyboard)
    change()
  }

  function reset() {
    dismiss()
    bySource.clear()
    reads.value = []
    indexedThrough = 0
    // Clear and restart restore the view before the replacement transcript reaches this component.
    void nextTick(() => indexReads(entries()))
  }

  return {
    reads,
    reading,
    archived,
    result,
    resultReturn,
    openRead,
    remember,
    back,
    backToRead,
    showResult,
    latest,
    reset,
    // Save the working log position while an earlier read or diagnostic detour is open.
    workingPosition: () =>
      origin.value && { scrollTop: origin.value.top, following: origin.value.following },
  }
}
