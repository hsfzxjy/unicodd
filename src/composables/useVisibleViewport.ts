import { onMounted, onUnmounted, ref, type Ref } from 'vue'

export function useVisibleViewport(application: Ref<HTMLElement | undefined>) {
  const shortViewport = ref(false)
  const viewport = window.visualViewport
  function fitViewport() {
    const layoutHeight = document.documentElement.clientHeight
    const height = viewport?.scale === 1 ? viewport.height : layoutHeight
    shortViewport.value = height <= 540
    if (height < layoutHeight) application.value?.style.setProperty('--app-height', `${height}px`)
    else application.value?.style.removeProperty('--app-height')
  }
  onMounted(() => {
    fitViewport()
    if (viewport) viewport.addEventListener('resize', fitViewport)
    else window.addEventListener('resize', fitViewport)
  })
  onUnmounted(() => {
    if (viewport) viewport.removeEventListener('resize', fitViewport)
    else window.removeEventListener('resize', fitViewport)
  })
  return shortViewport
}
