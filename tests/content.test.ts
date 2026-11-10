import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { createContentLoader } from '../src/lib/content'
import { createEngine } from '../src/lib/engine'

const engine = createEngine(async () => {
  const module = await import('../src/lib/wasm/pkg/unicodd_core.js')
  const binary = await readFile(
    new URL('../src/lib/wasm/pkg/unicodd_core_bg.wasm', import.meta.url),
  )
  await module.default({ module_or_path: binary })
  return module
})
const root = new URL('../public/content/', import.meta.url)
const read = (path: string) => readFile(new URL(path, root))
const content = createContentLoader(read, engine)
const gate = async () => (await content.manifest())[0]

it('loads the registered production level and verifies both checks independently through WASM', async () => {
  const catalog = await content.manifest()
  expect(catalog.map(({ id, label }) => [id, label])).toEqual([['001-the-gate', 'The Gate']])
  const { program, initialInputs, narrative } = await content.level(catalog[0])
  expect(narrative.system).toBe('archive-gateway')
  expect(initialInputs.username).toBe('café')
  for (const [username, solved, filter, resolution] of [
    [initialInputs.username, false, false, true],
    ['cafe', false, true, false],
    ['cafe\u0301', true, true, true],
    ['cafe\u0341', true, true, true],
  ] as const) {
    expect(await engine.evaluate(program, { username }, true)).toMatchObject({
      ok: true,
      value: {
        solved,
        checks: [
          { id: 'reserved_filter', actual: filter, passed: filter },
          { id: 'identity_resolution', actual: resolution, passed: resolution },
        ],
        trace: expect.arrayContaining([
          {
            id: 'raw_username',
            op: 'input',
            dependencies: [],
            result: { type: 'text', value: username },
          },
        ]),
      },
    })
  }
})

function withFile(file: string, body: string | Uint8Array | Error) {
  return createContentLoader(async (path) => {
    if (path !== file) return read(path)
    if (body instanceof Error) throw body
    return typeof body === 'string' ? new TextEncoder().encode(body) : body
  }, engine)
}

it('identifies invalid catalog versions, duplicate IDs and unsafe paths', async () => {
  const entry = await gate()
  for (const [value, message] of [
    [{ version: 2 }, /manifest\.json.*version.*Unsupported/],
    [{ version: 1, levels: [entry, entry] }, /levels\[1\]\.id.*duplicate/],
    [
      { version: 1, levels: [{ ...entry, puzzle: '../puzzle.json' }] },
      /levels\[0\]\.puzzle.*relative/,
    ],
  ] as const) {
    await expect(withFile('manifest.json', JSON.stringify(value)).manifest()).rejects.toThrow(
      message,
    )
  }
})

it('reports the affected file for unavailable, malformed, or invalid UTF-8 content', async () => {
  const entry = await gate()
  for (const [body, message] of [
    [new Error('HTTP 404'), /narrative\.json.*404/],
    ['{', /narrative\.json.*Invalid UTF-8 JSON/],
    [new Uint8Array([0xff]), /narrative\.json.*Invalid UTF-8 JSON/],
  ] as const) {
    await expect(withFile(entry.narrative, body).level(entry)).rejects.toThrow(message)
  }
})

it('reports WASM version and graph errors, and validates authored starting drafts', async () => {
  const entry = await gate()
  const puzzle = JSON.parse((await read(entry.puzzle)).toString())
  for (const [changes, message] of [
    [{ version: 2 }, /puzzle\.json.*version.*invalid_program/],
    [
      { nodes: [{ id: 'broken', op: 'not', args: ['missing'] }] },
      /puzzle\.json.*nodes\[0\]\.args.*Unknown dependency/,
    ],
    [{ initialInputs: {} }, /puzzle\.json.*initialInputs\.username.*Missing/],
    [
      { initialInputs: { username: '\ud800' } },
      /puzzle\.json.*initialInputs\.username.*Unpaired surrogate/,
    ],
    [
      { initialInputs: { username: 'é'.repeat(16385) } },
      /puzzle\.json.*initialInputs\.username.*resource_limit/,
    ],
  ] as const) {
    const body = JSON.stringify({ ...puzzle, ...changes })
    await expect(withFile(entry.puzzle, body).level(entry)).rejects.toThrow(message)
  }
})

it('rejects unknown and missing narrative references and invalid field types', async () => {
  const entry = await gate()
  const narrative = JSON.parse((await read(entry.narrative)).toString())
  for (const [changes, message] of [
    [{ checks: {} }, /narrative\.json.*checks\.reserved_filter.*Missing/],
    [{ inputs: { invalid: 'Other' } }, /narrative\.json.*inputs\.invalid.*Unknown field/],
    [{ hints: true }, /narrative\.json.*hints.*Expected an array/],
    [{ version: 3 }, /narrative\.json.*version.*Unsupported/],
  ] as const) {
    const body = JSON.stringify({ ...narrative, ...changes })
    await expect(withFile(entry.narrative, body).level(entry)).rejects.toThrow(message)
  }
})
