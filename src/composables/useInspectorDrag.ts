import { onBeforeUnmount, type Ref } from 'vue'

interface Position {
  x: number
  y: number
}

interface Drag {
  type: 'pointer' | 'touch'
  id: number
  anchor: number
  origin: Position
  startedAt: number
  endpoint?: number
  position?: Position
}

export function useInspectorDrag(
  scroll: Ref<HTMLElement | undefined>,
  select: (first: number, last: number) => void,
) {
  let drag: Drag | undefined
  let frame = 0
  let suppressClick = false

  function block(target: EventTarget | null) {
    const button = target instanceof Element && target.closest<HTMLElement>('[data-point-index]')
    return button && scroll.value?.contains(button) ? button : undefined
  }

  function start(event: Event, type: Drag['type'], id: number, x: number, y: number) {
    if (drag) return
    suppressClick = false
    const button = block(event.target)
    if (!button) return
    drag = {
      type,
      id,
      anchor: Number(button.dataset.pointIndex),
      origin: { x, y },
      startedAt: event.timeStamp,
    }
    return button
  }

  function finish() {
    drag = undefined
    cancelAnimationFrame(frame)
    frame = 0
  }

  function extend() {
    frame = 0
    const container = scroll.value
    const position = drag?.position
    if (!drag || !position || !container) return

    const { x, y } = position
    const { top, bottom, left, right } = container.getBoundingClientRect()
    const outer = container.closest<HTMLElement>('.composer-arguments')
    const clip = outer?.clientHeight ? outer.getBoundingClientRect() : undefined
    const visibleTop = Math.max(top, clip?.top ?? 0)
    const visibleBottom = Math.min(bottom, clip?.bottom ?? window.innerHeight)
    if (x < left || x >= right || visibleBottom <= visibleTop) return

    const sampleY = Math.max(visibleTop + 2, Math.min(visibleBottom - 2, y))
    const button = block(document.elementFromPoint(x, sampleY))
    if (button) {
      const endpoint = Number(button.dataset.pointIndex)
      if (endpoint !== drag.endpoint) {
        drag.endpoint = endpoint
        select(Math.min(drag.anchor, endpoint), Math.max(drag.anchor, endpoint))
      }
    }

    const edge = Math.min(12, (visibleBottom - visibleTop) / 4)
    const delta = Math.min(0, y - visibleTop - edge) + Math.max(0, y - visibleBottom + edge)
    if (!delta) return
    const previousTop = container.scrollTop
    container.scrollTop += Math.sign(delta) * Math.min(14, Math.ceil(Math.abs(delta) / 2))
    if (container.scrollTop !== previousTop) frame = requestAnimationFrame(extend)
  }

  function move(x: number, y: number) {
    if (!drag) return
    suppressClick = true
    drag.position = { x, y }
    cancelAnimationFrame(frame)
    extend()
  }

  function pointerDown(event: PointerEvent) {
    if (event.pointerType === 'touch' || event.button !== 0 || !event.isPrimary) return
    start(event, 'pointer', event.pointerId, event.clientX, event.clientY)?.setPointerCapture(
      event.pointerId,
    )
  }

  function pointerMove(event: PointerEvent) {
    if (drag?.type !== 'pointer' || drag.id !== event.pointerId) return
    const { clientX: x, clientY: y } = event
    if (drag.position || Math.hypot(x - drag.origin.x, y - drag.origin.y) >= 4) move(x, y)
  }

  function pointerEnd(event: PointerEvent) {
    if (drag?.type === 'pointer' && drag.id === event.pointerId) finish()
  }

  function touchStart(event: TouchEvent) {
    if (event.touches.length !== 1) {
      finish()
      return
    }
    const touch = event.changedTouches[0]
    start(event, 'touch', touch.identifier, touch.clientX, touch.clientY)
  }

  function touchMove(event: TouchEvent) {
    if (drag?.type !== 'touch') return
    const touch = Array.from(event.changedTouches).find(({ identifier }) => identifier === drag?.id)
    if (!touch) return
    const { clientX: x, clientY: y } = touch
    if (!drag.position) {
      const width = Math.abs(x - drag.origin.x)
      const height = Math.abs(y - drag.origin.y)
      if (Math.max(width, height) < 6) return
      // An immediate vertical swipe scrolls. A held touch can start a range in any direction.
      if (height >= width && event.timeStamp - drag.startedAt < 300) {
        finish()
        return
      }
    }
    if (!event.cancelable) {
      finish()
      return
    }
    event.preventDefault()
    move(x, y)
  }

  function touchEnd(event: TouchEvent) {
    if (
      drag?.type === 'touch' &&
      Array.from(event.changedTouches).some(({ identifier }) => identifier === drag?.id)
    )
      finish()
  }

  function contextMenu(event: MouseEvent) {
    if (drag?.type === 'touch') event.preventDefault()
  }

  function click(event: MouseEvent, index: number) {
    if (event.detail === 0 || !suppressClick) select(index, index)
  }

  onBeforeUnmount(finish)
  return {
    pointerDown,
    pointerMove,
    pointerEnd,
    touchStart,
    touchMove,
    touchEnd,
    contextMenu,
    click,
  }
}
