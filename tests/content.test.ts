import { readdir } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { createContentLoader } from '../src/lib/content'
import { engine, fixtures, production, productionRoot, readProduction } from './scenario-content'

it('ships only The Relay in a scenario catalog', async () => {
  const entries = await production.manifest()
  expect(entries.map(({ id, label }) => [id, label])).toEqual([['001-the-relay', 'The Relay']])
  expect(await readdir(productionRoot)).toEqual(['manifest.json', 'scenarios'])
  expect(await readdir(new URL('scenarios/', productionRoot))).toEqual(['001-the-relay'])
  const scenario = await production.scenario(entries[0])
  expect(scenario.hosts[0].resources).toHaveLength(6)
})

it('loads a different authored structure with an initial host and a flag-gated second host', async () => {
  const [entry] = await fixtures.manifest()
  const scenario = await fixtures.scenario(entry)
  expect(scenario.initialHost).toBe('shelf')
  expect(scenario.hosts[1].discover).toBe('index_seen')
  expect(scenario.objective.read).toBe('annex_file')
})

function override(file: string, body: unknown) {
  return createContentLoader(async (path) => {
    if (path !== file) return readProduction(path)
    if (body instanceof Error) throw body
    return body instanceof Uint8Array ? body : new TextEncoder().encode(JSON.stringify(body))
  }, engine)
}

it('rejects invalid manifest versions, duplicate IDs and unsafe references', async () => {
  const [entry] = await production.manifest()
  for (const [value, issue] of [
    [{ version: 2 }, /manifest\.json.*version.*Unsupported/],
    [{ version: 1, scenarios: [entry, entry] }, /scenarios\[1\]\.id.*Duplicate/],
    [
      { version: 1, scenarios: [{ ...entry, scenario: '../scenario.json' }] },
      /scenarios\[0\]\.scenario.*relative/,
    ],
  ] as const) {
    await expect(override('manifest.json', value).manifest()).rejects.toThrow(issue)
  }
})

it('reports invalid UTF-8, malformed JSON, and missing assets by path', async () => {
  const [entry] = await production.manifest()
  await expect(override(entry.scenario, new Uint8Array([255])).scenario(entry)).rejects.toThrow(
    /scenario\.json.*Invalid UTF-8/,
  )
  await expect(override(entry.scenario, new Uint8Array([123])).scenario(entry)).rejects.toThrow(
    /scenario\.json.*Invalid JSON/,
  )
  const asset = entry.scenario.replace('scenario.json', 'files/README.txt')
  await expect(override(asset, new Error('HTTP 404')).scenario(entry)).rejects.toThrow(
    /README\.txt.*404/,
  )
})

it.each([
  [
    'version',
    (body) => {
      body.version = 2
    },
    /scenario\.json.*version.*Unsupported/,
  ],
  [
    'role',
    (body) => {
      body.hosts[0].resources[5].access.roles = ['visitor']
    },
    /resources\[5\].*Unknown role/,
  ],
  [
    'effect',
    (body) => {
      body.hosts[0].login.success[0] = { type: 'execute' }
    },
    /login\.success\[0\]\.type.*Unsupported effect/,
  ],
  [
    'objective',
    (body) => {
      body.objective.read = 'queue'
    },
    /objective\.read.*Unknown file resource/,
  ],
  [
    'hierarchy',
    (body) => {
      body.hosts[0].resources[0].path = '/missing/README'
    },
    /README requires a directory/,
  ],
  [
    'flag',
    (body) => {
      body.hosts[0].resources[0].discover = { flag: 'unknown' }
    },
    /Unknown flag/,
  ],
  [
    'binding',
    (body) => {
      body.hosts[0].login.input = 'missing'
    },
    /Unknown puzzle input/,
  ],
  [
    'feedback',
    (body) => {
      body.hosts[0].login.rejected[0].check = 'missing'
    },
    /Unknown puzzle check/,
  ],
  [
    'character lines',
    (body) => {
      body.hosts[0].resources[3].inspectLines = [99]
    },
    /inspectLines.*line number/,
  ],
] as [string, (body: any) => void, RegExp][])(
  'rejects invalid %s',
  async (_name, mutate, issue) => {
    const [entry] = await production.manifest()
    const data = JSON.parse((await readProduction(entry.scenario)).toString())
    mutate(data)
    await expect(override(entry.scenario, data).scenario(entry)).rejects.toThrow(issue)
  },
)

it('uses WASM to reject incompatible programs and invalid authored drafts', async () => {
  const [entry] = await production.manifest()
  const path = entry.scenario.replace('scenario.json', 'puzzle.json')
  const puzzle = JSON.parse((await readProduction(path)).toString())
  await expect(override(path, { ...puzzle, version: 2 }).scenario(entry)).rejects.toThrow(
    /puzzle\.json.*invalid_program/,
  )
  const data = JSON.parse((await readProduction(entry.scenario)).toString())
  data.hosts[0].login.initial = 'é'.repeat(16385)
  await expect(override(entry.scenario, data).scenario(entry)).rejects.toThrow(
    /puzzle\.json.*resource_limit/,
  )
})
