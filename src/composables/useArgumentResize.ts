import { nextTick, ref, type Ref } from 'vue'

const maximumHeight = 220

export function useArgumentResize(key: string, control: Ref<HTMLTextAreaElement | undefined>) {
  const storageKey = 'unicodd.argument-height.' + key
  const height = ref<number>()
  try {
    const saved = Number(localStorage.getItem(storageKey))
    if (Number.isInteger(saved) && saved > 0 && saved <= maximumHeight) height.value = saved
  } catch {
    // Editing remains available when storage is blocked.
  }

  let drag: { pointer: number; y: number; height: number } | undefined

  function resize(value: number) {
    const field = control.value
    if (!field) return
    const min = Number.parseFloat(getComputedStyle(field).minHeight)
    const visible = window.visualViewport
    const viewport = visible?.scale === 1 ? visible.height : document.documentElement.clientHeight
    const max = Math.min(maximumHeight, Math.floor(viewport * 0.28))
    const next = Math.max(min, Math.min(max, Math.round(value)))
    if (next === field.offsetHeight) return
    const list = field.closest<HTMLElement>('.composer-arguments')
    const bottom = field.getBoundingClientRect().bottom
    height.value = next
    void nextTick(() => {
      if (list && list.scrollHeight > list.clientHeight)
        list.scrollTop += field.getBoundingClientRect().bottom - bottom
    })
  }

  function save() {
    if (height.value === undefined) return
    try {
      localStorage.setItem(storageKey, String(height.value))
    } catch {
      // The height still applies while this editor is open.
    }
  }

  function start(event: PointerEvent) {
    if (event.button !== 0 || drag || !control.value) return
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    drag = { pointer: event.pointerId, y: event.clientY, height: control.value.offsetHeight }
  }

  function move(event: PointerEvent) {
    if (drag?.pointer === event.pointerId) resize(drag.height + drag.y - event.clientY)
  }

  function end(event: PointerEvent) {
    if (drag?.pointer !== event.pointerId) return
    drag = undefined
    save()
  }

  function keydown(event: KeyboardEvent) {
    if (!control.value) return
    const step = event.key === 'ArrowUp' ? 12 : event.key === 'ArrowDown' ? -12 : 0
    if (!step) return
    event.preventDefault()
    resize(control.value.offsetHeight + step)
    save()
  }

  return { height, start, move, end, keydown }
}
