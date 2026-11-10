import type { Engine } from '../types'

// The UI takes an injected engine, including when the module is unavailable.
export const engine: Engine = {
  async info() { return unavailable() },
  async validate() { return unavailable() },
  async evaluate() { return unavailable() },
  async normalize() { return unavailable() },
}

function unavailable() {
  return { ok: false, error: { code: 'engine_unavailable', message: 'The evaluator is unavailable.' } } as const
}
