import { readdir } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { createContentLoader } from '../src/lib/content'
import { engine, fixtures, production, productionRoot, readProduction } from './scenario-content'

it('loads the production scenario catalog in progression order', async () => {
  const entries = await production.manifest()
  expect(entries.map(({ id }) => id)).toEqual([
    '001-the-relay',
    '002-dead-letter',
    '003-the-index',
    '004-the-backlog',
    '005-the-handshake',
    '006-the-release',
  ])
  await expect(production.campaign(entries)).resolves.toHaveLength(entries.length)
  expect(await readdir(productionRoot)).toEqual(['manifest.json', 'recovery', 'scenarios'])
  expect(await readdir(new URL('scenarios/', productionRoot))).toEqual(entries.map(({ id }) => id))
  const scenario = await production.scenario(entries[0])
  expect(scenario.inbox?.initial).toEqual(['favor'])
  expect(scenario.hosts[0].resources.filter(({ type }) => type === 'mail')).toHaveLength(3)
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
    'reversed output timing range',
    (body) => {
      body.outputTiming.cat[0].maxMs = 20
    },
    /outputTiming\.cat\[0\]\.maxMs.*integer from 70 to 2000/,
  ],
  [
    'duplicate output timing boundary',
    (body) => {
      body.outputTiming.cat[1].afterRows = 0
    },
    /outputTiming\.cat\[1\]\.afterRows.*Duplicate/,
  ],
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
      body.hosts[0].resources.find(
        (resource: { id: string }) => resource.id === 'incident',
      ).access.roles = ['visitor']
    },
    /resources\[\d+\].*Unknown role/,
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
      body.hosts[0].resources.find(
        (resource: { id: string }) => resource.id === 'keypad',
      ).inspectLines = [99]
    },
    /inspectLines.*line number/,
  ],
  [
    'initial mail reference',
    (body) => {
      body.inbox.initial = ['unknown']
    },
    /inbox\.initial.*Unknown inbox message/,
  ],
  [
    'delivery reference',
    (body) => {
      body.hosts[0].login.success.push({ type: 'deliverMail', message: 'unknown' })
    },
    /login\.success.*Unknown inbox message/,
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

it('validates archived mail asset references and message headers', async () => {
  const [entry] = await production.manifest()
  const file = entry.scenario.replace('scenario.json', 'mail/login-compatibility.json')
  const asset = JSON.parse((await readProduction(file)).toString())
  await expect(override(file, new Error('HTTP 404')).scenario(entry)).rejects.toThrow(
    /login-compatibility\.json.*404/,
  )
  for (const [messages, issue] of [
    [[{ ...asset.messages[0], from: 'First\nSecond' }], /messages\[0\]\.from.*single-line/],
    [[asset.messages[0], asset.messages[0]], /messages\[1\]\.id.*Duplicate/],
    [[{ ...asset.messages[0], body: '' }], /messages\[0\]\.body.*nonempty/],
  ] as const) {
    await expect(override(file, { messages }).scenario(entry)).rejects.toThrow(issue)
  }
})

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

it('rejects unknown progression destinations and unreachable scenarios', async () => {
  const entries = await production.manifest()
  const relay = entries[0].scenario
  const data = JSON.parse((await readProduction(relay)).toString())
  data.objective.onComplete[1].scenario = 'missing-host'
  await expect(override(relay, data).campaign(entries)).rejects.toThrow(
    /Invalid discovery destination/,
  )
  data.objective.onComplete.pop()
  await expect(override(relay, data).campaign(entries)).rejects.toThrow(/Unreachable scenario/)
  data.objective.onComplete.push({ type: 'discover', scenario: entries[0].id })
  await expect(override(relay, data).campaign(entries)).rejects.toThrow(
    /Invalid discovery destination/,
  )
})

it('rejects invalid scalar references, resource links, and operation names', async () => {
  const [, entry] = await production.manifest()
  const sample = entry.scenario.replace('scenario.json', 'files/legacy-address.txt')
  for (const invalid of ['U+D800', 'U+110000', 'U+NOTHEX']) {
    await expect(
      override(sample, new TextEncoder().encode(invalid)).scenario(entry),
    ).rejects.toThrow(/Invalid scalar notation/)
  }
  const data = JSON.parse((await readProduction(entry.scenario)).toString())
  data.hosts[0].operation.success[2].resource = 'absent'
  await expect(override(entry.scenario, data).scenario(entry)).rejects.toThrow(
    /Unknown linked resource/,
  )
  data.hosts[0].operation.command = 'transfer'
  await expect(override(entry.scenario, data).scenario(entry)).rejects.toThrow(
    /Unknown puzzle command/,
  )
})

it('validates multi-field bindings and distinct commands', async () => {
  const [, dead, index] = await production.manifest()
  const route = JSON.parse((await readProduction(dead.scenario)).toString())
  const fields = route.hosts[0].operation.fields
  fields[1].input = fields[0].input
  await expect(override(dead.scenario, route).scenario(dead)).rejects.toThrow(
    /Duplicate value "header"/,
  )
  fields[1].input = 'envelope'
  fields[1].fixed = 'Mira'
  await expect(override(dead.scenario, route).scenario(dead)).rejects.toThrow(
    /Fixed fields cannot have a draft/,
  )
  delete fields[1].initial
  await expect(override(dead.scenario, route).scenario(dead)).rejects.toThrow(
    /command argument count/,
  )
  const audit = JSON.parse((await readProduction(index.scenario)).toString())
  audit.hosts[0].operations.push(audit.hosts[0].operations[0])
  await expect(override(index.scenario, audit).scenario(index)).rejects.toThrow(
    /Duplicate puzzle command/,
  )
})

it('validates recovery datasets, authoring parameters and cross-scenario handoffs', async () => {
  const entries = await production.manifest()
  const [, , , backlog, handshake, release] = entries
  const datasetPath = 'recovery/8c2f.json'
  const read = async (path: string) => JSON.parse((await readProduction(path)).toString())
  const dataset = await read(datasetPath)
  const original = dataset.registrations[1].name
  dataset.registrations[1].name = 'Mira'
  await expect(override(datasetPath, dataset).scenario(backlog)).rejects.toThrow(
    /Recovery registrations differ from the verified original export/,
  )
  dataset.registrations[1].name = original
  dataset.receipts[1].owner = dataset.receipts[0].owner
  await expect(override(datasetPath, dataset).scenario(handshake)).rejects.toThrow(
    /one verified receipt from its owner/,
  )
  dataset.receipts[1].owner = dataset.registrations[1].owner
  dataset.cursors['deployed-v1'].record = 'absent'
  await expect(override(datasetPath, dataset).scenario(backlog)).rejects.toThrow(
    /Invalid queue cursor reference/,
  )
  delete dataset.cursors['deployed-v1'].record
  dataset.auditSamples[0].text = '\ud800'
  await expect(override(datasetPath, dataset).scenario(release)).rejects.toThrow(
    /Unpaired surrogate/,
  )

  const queue = await read(backlog.scenario)
  const [locale, strength, strategy] = queue.hosts[0].recovery[1].fields
  for (const [field, value, issue] of [
    [locale, 'invalid', /Choose en-US or sv-SE/],
    [strength, 'invalid', /Choose primary, secondary, or tertiary/],
    [strategy, 'invalid', /Choose title, composite, or inclusive/],
  ] as const) {
    const initial = field.initial
    field.initial = value
    await expect(override(backlog.scenario, queue).scenario(backlog)).rejects.toThrow(issue)
    field.initial = initial
  }
  queue.hosts[0].recovery[1].rejected[0].check = 'typo'
  await expect(override(backlog.scenario, queue).scenario(backlog)).rejects.toThrow(
    /Unknown recovery check/,
  )

  const broker = await read(handshake.scenario)
  broker.recovery.prior = entries[2].id
  await expect(override(handshake.scenario, broker).campaign(entries)).rejects.toThrow(
    /Expected an earlier recovery scenario with the same dataset/,
  )
  const audit = await read(release.scenario)
  audit.objective.action = 'verify'
  await expect(override(release.scenario, audit).scenario(release)).rejects.toThrow(
    /Unknown recovery completion action/,
  )
})
