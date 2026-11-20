import { computed, nextTick, ref, shallowRef, watch, type Ref } from 'vue'
import type { Output } from '../lib/runtime'
import type { Entry } from '../lib/workspace'

export type ReadOutput = Extract<Output, { kind: 'file' } | { kind: 'mail' }>

export interface EarlierRead {
  key: string
  entry: number
  source: string
  label: string
  output: ReadOutput
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
  move: (top: number) => void
  followLatest: () => void
  change: () => void
}

const inset = 6

export function useTerminalReads({
  entries,
  scroll,
  following,
  expand,
  move,
  followLatest,
  change,
}: Transcript) {
  const bySource = new Map<string, EarlierRead>()
  const reads = shallowRef<EarlierRead[]>([])
  const selected = shallowRef<EarlierRead>()
  const origin = shallowRef<Position>()
  const resultReturn = shallowRef<Position>()
  const openedAfter = ref(0)
  let indexedThrough = 0
  let navigation = 0

  const reading = computed(() => Boolean(origin.value))
  const archived = computed(() => {
    const read = selected.value
    return read && !entries().some(({ id }) => id === read.entry) ? read : undefined
  })
  const result = computed(() => {
    const entry = entries().at(-1)
    if (!reading.value || !entry || entry.waiting || entry.id <= openedAfter.value) return
    const milestone = Boolean(
      entry.freshProgress && entry.output.some((row) => 'progress' in row && row.progress),
    )
    if (milestone || entry.output.some((row) => row.kind === 'error'))
      return { id: entry.id, milestone }
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
        bySource.set(key, { key, entry: entry.id, source, label, output, offset: 0 })
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

  function moveTo(el: HTMLElement, at: number) {
    if (scroll.value) move(scroll.value.scrollTop + offset(el) - at)
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

  function restore(place: Position) {
    const entry = place.entry === undefined ? undefined : findEntry(place.entry)
    const el = place.resource
      ? entry?.querySelector<HTMLElement>('.terminal-file, .terminal-mail')
      : entry
    if (el) moveTo(el, place.offset)
    else move(place.entry === undefined ? place.top : 0)
  }

  function remember() {
    const read = selected.value
    if (!read) return
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
      openedAfter.value = (latest?.waiting ? history.at(-2)?.id : latest?.id) ?? 0
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

  async function back() {
    const place = origin.value
    if (!place) return
    remember()
    dismiss()
    const request = navigation
    await nextTick()
    if (request !== navigation) return
    if (place.following) followLatest()
    else restore(place)
    change()
  }

  async function showResult(keyboard: boolean) {
    const request = ++navigation
    const place = resultReturn.value
    if (place) {
      resultReturn.value = undefined
      await nextTick()
      if (request !== navigation) return
      restore(place)
      if (keyboard) scroll.value?.focus({ preventScroll: true })
      change()
      return
    }
    if (!result.value) return
    const { id, milestone } = result.value
    remember()
    resultReturn.value = capture(selected.value)
    expand(id)
    await nextTick()
    if (request !== navigation) return
    const el = findEntry(id)
    if (el)
      moveTo(
        el.querySelector<HTMLElement>(milestone ? '.progress-band' : '.terminal-line.error') ?? el,
        inset,
      )
    if (keyboard) scroll.value?.focus({ preventScroll: true })
    change()
  }

  async function latest() {
    if (reading.value) {
      remember()
      dismiss()
      await nextTick()
    }
    followLatest()
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
    showResult,
    latest,
    reset,
    // Save the working log position while an earlier read or diagnostic detour is open.
    workingPosition: () =>
      origin.value && { scrollTop: origin.value.top, following: origin.value.following },
  }
}
