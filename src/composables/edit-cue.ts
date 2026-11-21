export function paintEditCue(targets: HTMLElement[]) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const strength = { '--edit-cue-opacity': '1' }
  const animations = targets.map((target) => {
    target.dataset.editCue = ''
    return target.animate([strength, reduced ? strength : { '--edit-cue-opacity': '0' }], {
      duration: reduced ? 500 : 180,
      easing: 'ease-out',
    })
  })
  let active = true
  function clear() {
    if (!active) return
    active = false
    for (const target of targets) delete target.dataset.editCue
    for (const animation of animations) animation.cancel()
  }
  void Promise.all(animations.map(({ finished }) => finished)).then(clear, () => {})
  return clear
}
