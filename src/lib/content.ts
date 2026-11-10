import type { Engine, EngineError, Narrative, Program, Target } from '../types.ts'
import { unpairedSurrogate } from './unicode.ts'

export interface LevelEntry {
  id: string
  label: string
  puzzle: string
  narrative: string
  available: boolean
}

const manifestPath = 'manifest.json'
const identifier = /^[A-Za-z0-9_.-]{1,64}$/
const jsonPath = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/

function invalid(file: string, field: string, message: string): never {
  throw new Error(`${file}${field ? ` · ${field}` : ''} — ${message}`)
}

function object(
  value: unknown,
  file: string,
  field: string,
  keys?: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(file, field, 'Expected an object.')
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (keys && !keys.includes(key)) invalid(file, `${field}.${key}`, 'Unknown field.')
  }
  return record
}

function array(value: unknown, file: string, field: string): unknown[] {
  if (!Array.isArray(value)) invalid(file, field, 'Expected an array.')
  return value
}

function string(value: unknown, file: string, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    invalid(file, field, allowEmpty ? 'Expected text.' : 'Expected nonempty text.')
  }
  const offset = unpairedSurrogate(value)
  if (offset !== undefined) invalid(file, field, `Unpaired surrogate at UTF-16 offset ${offset}.`)
  return value
}

function version(value: unknown, file: string) {
  if (value !== 1) invalid(file, 'version', 'Unsupported content schema version. Expected 1.')
}

function readManifest(value: unknown): LevelEntry[] {
  const file = manifestPath
  const data = object(value, file, '$', ['version', 'levels'])
  version(data.version, file)
  const seen = new Set<string>()
  return array(data.levels, file, 'levels').map((value, index) => {
    const field = `levels[${index}]`
    const entry = object(value, file, field, ['id', 'label', 'puzzle', 'narrative', 'available'])
    const id = string(entry.id, file, `${field}.id`)
    if (!identifier.test(id) || seen.has(id))
      invalid(file, `${field}.id`, 'Invalid or duplicate level ID.')
    seen.add(id)
    const label = string(entry.label, file, `${field}.label`)
    const puzzle = string(entry.puzzle, file, `${field}.puzzle`)
    const narrative = string(entry.narrative, file, `${field}.narrative`)
    for (const [key, path] of [
      ['puzzle', puzzle],
      ['narrative', narrative],
    ]) {
      if (!jsonPath.test(path))
        invalid(file, `${field}.${key}`, 'Expected a relative JSON path within content/.')
    }
    if (entry.available !== undefined && typeof entry.available !== 'boolean') {
      invalid(file, `${field}.available`, 'Expected true or false.')
    }
    return { id, label, puzzle, narrative, available: entry.available ?? true }
  })
}

function readIdMap<T>(
  value: unknown,
  ids: readonly string[],
  file: string,
  field: string,
  read: (value: unknown, path: string) => T,
): Record<string, T> {
  const data = object(value, file, field, ids)
  return Object.fromEntries(
    ids.map((id) => {
      const path = `${field}.${id}`
      if (!Object.hasOwn(data, id)) invalid(file, path, 'Missing entry for declared ID.')
      return [id, read(data[id], path)]
    }),
  )
}

function readNarrative(value: unknown, file: string, program: Program): Narrative {
  const data = object(value, file, '$', [
    'version',
    'title',
    'system',
    'description',
    'objective',
    'introduction',
    'inputs',
    'checks',
    'hints',
    'feedback',
    'recovered',
    'nextTarget',
  ])
  version(data.version, file)
  const text = (field: string) => string(data[field], file, field)
  const optional = (field: string) => (data[field] === undefined ? undefined : text(field))
  const lines = (field: string) =>
    array(data[field], file, field).map((line, index) => string(line, file, `${field}[${index}]`))
  const feedback = object(data.feedback, file, 'feedback', ['failed', 'passed'])
  return {
    title: text('title'),
    system: text('system'),
    description: text('description'),
    objective: text('objective'),
    introduction: lines('introduction'),
    inputs: readIdMap(data.inputs, program.inputs, file, 'inputs', (value, path) =>
      string(value, file, path),
    ),
    checks: readIdMap(
      data.checks,
      program.checks.map(({ id }) => id),
      file,
      'checks',
      (value, path) => {
        const check = object(value, file, path, ['label', 'detail'])
        return {
          label: string(check.label, file, `${path}.label`),
          detail: string(check.detail, file, `${path}.detail`),
        }
      },
    ),
    hints: data.hints === undefined ? undefined : lines('hints'),
    feedback: {
      failed: string(feedback.failed, file, 'feedback.failed'),
      passed: string(feedback.passed, file, 'feedback.passed'),
    },
    recovered: optional('recovered'),
    nextTarget: optional('nextTarget'),
  }
}

function engineFailure(file: string, error: EngineError): never {
  invalid(file, error.path ?? '', `${error.code} · ${error.message}`)
}

export function createContentLoader(
  read: (path: string) => Promise<ArrayBuffer | Uint8Array>,
  engine: Engine,
) {
  async function json(file: string): Promise<unknown> {
    let bytes: ArrayBuffer | Uint8Array
    try {
      bytes = await read(file)
    } catch (error) {
      invalid(file, '', error instanceof Error ? error.message : 'Could not read content.')
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
    } catch (error) {
      invalid(file, '', `Invalid UTF-8 JSON. ${error instanceof Error ? error.message : ''}`)
    }
  }

  return {
    async manifest() {
      return readManifest(await json(manifestPath))
    },
    async level(entry: LevelEntry): Promise<Target> {
      const [puzzle, story] = await Promise.all([json(entry.puzzle), json(entry.narrative)])
      const { initialInputs: rawInputs, ...rawProgram } = object(puzzle, entry.puzzle, '$')
      const validation = await engine.validate(rawProgram)
      if (!validation.ok) engineFailure(entry.puzzle, validation.error)
      const program = rawProgram as unknown as Program
      const initialInputs = readIdMap(
        rawInputs,
        program.inputs,
        entry.puzzle,
        'initialInputs',
        (value, path) => string(value, entry.puzzle, path, true),
      )
      const narrative = readNarrative(story, entry.narrative, program)

      // Use the evaluator's input and resource limits on the authored starting state.
      const initial = await engine.evaluate(program, initialInputs)
      if (!initial.ok) {
        const path = initial.error.path?.replace(/^inputs(?=\.|$)/, 'initialInputs')
        engineFailure(entry.puzzle, { ...initial.error, path })
      }
      return { id: entry.id, program, initialInputs, narrative }
    },
  }
}
