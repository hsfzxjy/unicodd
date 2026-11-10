import type { Engine, EngineError, Result } from '../types'
import { unpairedSurrogate } from './unicode.ts'

type Bindings = typeof import('./wasm/pkg/unicodd_core.js')
type Operations = Pick<
  Bindings,
  'engine_info' | 'validate_program' | 'evaluate' | 'normalize_text' | 'inspect_scalar'
>
const encoder = new TextEncoder()
const programLimit = 13 * 1024 * 1024
const inputLimit = 2 * 1024 * 1024
const normalizeLimit = 128 * 1024

function failure(
  code: EngineError['code'],
  message: string,
  path?: string,
  offset?: number,
): Result<never> {
  return { ok: false, error: { code, message, path, offset } }
}

function surrogateError(
  text: string,
  code: 'invalid_program' | 'invalid_input',
  path: string,
): Result<never> | undefined {
  const offset = unpairedSurrogate(text)
  if (offset === undefined) return
  return failure(code, `Unpaired surrogate at UTF-16 offset ${offset}.`, path, offset)
}

function tooLarge(limit: number, path: string) {
  return failure('resource_limit', `Request exceeds ${limit / 1024} KiB of UTF-8.`, path)
}

function bytes(text: string, limit: number, path: string): Result<Uint8Array> {
  if (text.length > limit) return tooLarge(limit, path)
  const value = encoder.encode(text)
  return value.length > limit ? tooLarge(limit, path) : { ok: true, value }
}

function jsonBytes(
  data: unknown,
  limit: number,
  path: 'program' | 'inputs',
  code: 'invalid_program' | 'invalid_input',
): Result<Uint8Array> {
  let rejection: Result<never> | undefined
  let remaining = limit
  try {
    // Validate original strings before either JSON escaping or UTF-8 encoding.
    const text = JSON.stringify(data, (key, value: unknown) => {
      const location = key ? `${path}.${key}` : path
      remaining -= key.length + (typeof value === 'string' ? value.length : 0)
      rejection = remaining < 0 ? tooLarge(limit, path) : surrogateError(key, code, path)
      if (!rejection && typeof value === 'string') rejection = surrogateError(value, code, location)
      if (rejection) throw new TypeError('Invalid transport data')
      return value
    })
    return typeof text === 'string'
      ? bytes(text, limit, path)
      : failure(code, 'Expected a JSON object.', path)
  } catch {
    return rejection ?? failure(code, 'Could not serialize the request as JSON.', path)
  }
}

export function createEngine(load: () => Promise<Operations>): Engine {
  let loading: Promise<Operations> | undefined

  async function call<T>(execute: (module: Operations) => string): Promise<Result<T>> {
    let module: Operations
    try {
      module = await (loading ??= load())
    } catch {
      loading = undefined
      return failure(
        'engine_unavailable',
        'Could not initialize the Unicode evaluator. Reload the page to retry.',
      )
    }
    try {
      return JSON.parse(execute(module)) as Result<T>
    } catch {
      return failure('evaluation_failure', 'The Unicode evaluator could not complete the request.')
    }
  }

  return {
    info: () => call((module) => module.engine_info()),
    async validate(program) {
      const data = jsonBytes(program, programLimit, 'program', 'invalid_program')
      return data.ok ? call((module) => module.validate_program(data.value)) : data
    },
    async evaluate(program, inputs, trace = false) {
      const data = jsonBytes(program, programLimit, 'program', 'invalid_program')
      if (!data.ok) return data
      const snapshot = jsonBytes(inputs, inputLimit, 'inputs', 'invalid_input')
      return snapshot.ok
        ? call((module) => module.evaluate(data.value, snapshot.value, trace))
        : snapshot
    },
    async inspectScalar(text) {
      const invalid = surrogateError(text, 'invalid_input', 'text')
      if (invalid) return invalid
      if (text.length > 2) return failure('invalid_input', 'Expected one Unicode scalar.', 'text')
      return call((module) => module.inspect_scalar(encoder.encode(text)))
    },
    async normalize(text, form) {
      const invalid = surrogateError(text, 'invalid_input', 'text')
      if (invalid) return invalid
      const data = bytes(text, normalizeLimit, 'text')
      return data.ok ? call((module) => module.normalize_text(data.value, form)) : data
    },
  }
}

export const engine = createEngine(async () => {
  const module = await import('./wasm/pkg/unicodd_core.js')
  await module.default()
  return module
})
