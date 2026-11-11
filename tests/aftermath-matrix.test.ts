import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { afterAll, expect, it } from 'vitest'
import { campaignKey, createCampaign, type CampaignSnapshot } from '../src/lib/campaign'
import { parseCommand, puzzleAction } from '../src/lib/commands'
import type { Handoff, RecoveryCommand, RecoveryContext, RecoveryReport } from '../src/lib/recovery'
import { createRuntime } from '../src/lib/runtime'
import { inspect } from '../src/lib/unicode'
import matrix from './fixtures/aftermath-matrix.json'
import { engine, production } from './scenario-content'

const scenarios = production.manifest().then(production.campaign)
const first = 'https://strasse.trace.test/archive/GW-1842'
const second = 'https://straße.trace.test/archive/GW-2917/Cafe\u0301'
const route = ['nontransitional', first, second]
const framing = ['be', 'strict', 'quarantine', 'raw', 'network']
const reconciliation = ['opaque', 'id', '18.0']
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const wire = Buffer.from(
  '000F41434B7C47572D313834327CE29C93' +
    '0002C0AF0004E28258590000' +
    '001241434B7C47572D323931377C43616665CC81',
  'hex',
)

function extract<K extends Handoff['kind']>(
  handoff: Handoff | undefined,
  kind: K,
): Extract<Handoff, { kind: K }> {
  if (handoff?.kind !== kind) throw new Error('Expected ' + kind + ' evidence.')
  return handoff as Extract<Handoff, { kind: K }>
}

async function evaluate(
  command: RecoveryCommand,
  args: string[],
  prior?: Handoff,
  options: { context?: RecoveryContext; committed?: Handoff } = {},
): Promise<RecoveryReport> {
  const all = await scenarios
  const scenario = all.find((scenario) =>
    scenario.hosts.some((host) => host.recovery?.some((binding) => binding.command === command)),
  )!
  const result = await engine.runRecovery({
    version: 1,
    dataset: scenario.recovery!.dataset,
    command,
    args,
    prior,
    direct: true,
    ...options,
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

const lineage = (async () => {
  const plan = await evaluate('prepare', ['registration', 'preserve'])
  const preview = await evaluate('preview', ['grapheme', '4', 'isolate', 'escape'], undefined, {
    context: plan.context,
  })
  const verified = await evaluate('verify', [], undefined, { context: preview.context })
  const release = extract(
    (await evaluate('commit', [], undefined, { context: verified.context })).handoff,
    'release',
  )
  const dispatch = extract((await evaluate('dispatch', route, release)).handoff, 'dispatch')
  const ingestion = extract((await evaluate('deframe', framing, dispatch)).handoff, 'ingestion')
  return { release, dispatch, ingestion }
})()

const calculated = new Map<
  string,
  {
    inputs: { points: string[]; utf8: string }[]
    report: RecoveryReport
    output: Awaited<ReturnType<ReturnType<typeof createRuntime>['dispatch']>>['output']
    flags: readonly string[]
  }
>()
const failed = (report: RecoveryReport) =>
  report.checks.filter(({ passed }) => !passed).map(({ id }) => id)
const errors = (response: Awaited<ReturnType<ReturnType<typeof createRuntime>['dispatch']>>) =>
  (response.output ?? []).flatMap((row) => (row.kind === 'error' ? [row.text] : []))

afterAll(async () => {
  if (process.env.UPDATE_PUZZLE_MATRIX !== '1') return
  const folder = new URL('../private/testing/', import.meta.url)
  await mkdir(folder, { recursive: true })
  await writeFile(
    new URL('aftermath-regression-matrix.json', folder),
    JSON.stringify(
      {
        profiles: matrix.profiles,
        networkChunkEdges: [1, 10, 15, 30, 38, 48],
        captureHex: wire.toString('hex'),
        cases: matrix.cases.map((vector) => ({ ...vector, actual: calculated.get(vector.id) })),
      },
      null,
      2,
    ) + '\n',
  )
  const summaries = matrix.cases.map(({ id, command }) => {
    const trace = calculated.get(id)
    if (!trace) return '| ' + id + ' | ' + command + ' | No result |'
    const checks = failed(trace.report)
    return (
      '| ' +
      id +
      ' | ' +
      command +
      ' | ' +
      (trace.report.solved ? 'Passed' : checks.join(', ')) +
      ' |'
    )
  })
  await writeFile(
    new URL('aftermath-regression-matrix.md', folder),
    [
      '# Aftermath puzzle regression',
      '',
      'Calculated from the browser WASM build and scenario runtime. The companion JSON contains the exact arguments, scalar sequences, bytes, diagnostics, and staged evidence.',
      '',
      '| Candidate | Command | Result or failed checks |',
      '| --- | --- | --- |',
      ...summaries,
      '',
    ].join('\n'),
  )
})

it.each(matrix.cases)('$command · $id', async (vector) => {
  const [all, { release, dispatch, ingestion }] = await Promise.all([scenarios, lineage])
  const command = vector.command as RecoveryCommand
  const scenario = all.find((scenario) =>
    scenario.hosts.some((host) => host.recovery?.some((binding) => binding.command === command)),
  )!
  const prior =
    scenario.objective.handoff === 'dispatch'
      ? release
      : scenario.objective.handoff === 'ingestion'
        ? dispatch
        : ingestion
  const completed = all.slice(0, all.indexOf(scenario)).map(({ id }) => id)
  const campaign = createCampaign(all, undefined, undefined, {
    version: 1,
    completed,
    current: scenario.id,
    delivered: [],
    read: [],
    handoffs: {
      '006-the-release': release,
      '007-the-other-side': dispatch,
      '008-the-fragments': ingestion,
    },
  })
  const runtime = createRuntime(scenario, engine, campaign)
  const report = await evaluate(command, vector.args, prior)
  const response = await runtime.dispatch(puzzleAction(command, vector.args))
  expect(failed(report)).toEqual(vector.failed)
  expect(report.solved).toBe(!vector.failed.length)
  expect(errors(response).length > 0).toBe(!report.solved)
  expect(response.output).toContainEqual({ kind: 'report', rows: report.rows })
  expect(runtime.state.completed).toBe(false)
  if ('diagnostic' in vector) expect(errors(response).join('\n')).toContain(vector.diagnostic)
  for (const [label, ...fields] of vector.rows)
    expect(report.rows).toContainEqual(expect.objectContaining({ label, fields }))

  if (report.handoff?.kind === 'dispatch') expect(report.handoff).toEqual(dispatch)
  if (report.handoff?.kind === 'ingestion') expect(report.handoff).toEqual(ingestion)
  if (report.handoff?.kind === 'mirror') {
    const { evidence } = report.handoff
    expect(evidence.ingestion).toEqual(ingestion.evidence)
    expect(evidence.modernSearch['ᲊora']).toEqual(['AR-4101', 'AR-4102'])
    expect(evidence.legacySearch['Ᲊora']).toEqual(['AR-4101'])
    expect(evidence.legacySearch['ᲊora']).toEqual(['AR-4102'])
    for (const record of evidence.records)
      expect(evidence.legacyReferences[record.handle.toLowerCase()]).toBe(record.id)
    expect(evidence.records.map(({ rawLabel, rawDigest }) => [rawLabel, rawDigest])).toEqual(
      ['Mira', 'Mіra', 'Ᲊora', 'ᲊora', 'Cafe\u0301'].map((label) => [
        label,
        digest(Buffer.from(label)),
      ]),
    )
  }
  calculated.set(vector.id, {
    inputs: vector.args.map((text) => ({
      points: inspect(text).map(({ notation }) => notation),
      utf8: Buffer.from(text).toString('hex'),
    })),
    report,
    output: response.output,
    flags: runtime.state.flags,
  })
})

it('retains exact receipt bytes, the 49-byte capture, both ACK digests, and bounded error spans', async () => {
  const { release, dispatch, ingestion } = await lineage
  expect(release.outbox!.map(({ status }) => status)).toEqual(['QUEUED', 'QUEUED'])
  for (const source of release.outbox!)
    expect(source.digest).toBe(digest(Buffer.from(source.payload)))
  expect(dispatch.evidence.release).toEqual({
    identities: release.identities,
    outbox: release.outbox,
  })
  expect(dispatch.evidence.capture).toEqual([...wire])
  expect(dispatch.evidence.captureDigest).toBe(digest(wire))
  expect(ingestion.evidence.frames).toMatchObject([
    {
      offset: 0,
      payload: [...wire.subarray(2, 17)],
      digest: 'add55155df34d456558b28a66d5c6eee8c6a8e0969a0b956e3c05aa69e953552',
      disposition: {
        kind: 'accepted',
        receipt: 'GW-1842',
        owner: 'owner-1842',
        sourceDigest: release.outbox![0].digest,
      },
    },
    {
      offset: 17,
      payload: [0xc0, 0xaf],
      disposition: { kind: 'quarantined', offset: 19, length: 1 },
    },
    {
      offset: 21,
      payload: [0xe2, 0x82, 0x58, 0x59],
      disposition: { kind: 'quarantined', offset: 23, length: 2 },
    },
    { offset: 27, payload: [], disposition: { kind: 'heartbeat' } },
    {
      offset: 29,
      payload: [...wire.subarray(31)],
      digest: '1ca5e9061a25ecc3029e611367cccf949b1a110c3f1cb7155be855e35fc0e229',
      disposition: {
        kind: 'accepted',
        receipt: 'GW-2917',
        owner: 'owner-2917',
        sourceDigest: release.outbox![1].digest,
      },
    },
  ])
  const capture = await evaluate('capture', ['0', '49'], dispatch)
  expect(capture.rows.flatMap(({ hex }) => hex?.bytes ?? [])).toEqual([...wire])
  expect(capture.rows.flatMap(({ hex }) => (hex?.chunkStart ? [hex.offset] : []))).toEqual([
    0, 1, 10, 15, 30, 38, 48,
  ])
  const framed = await evaluate('deframe', framing, dispatch)
  expect(framed.rows.flatMap(({ hex }) => (hex?.highlight ? [hex.highlight] : []))).toEqual([
    [19, 20],
    [23, 25],
  ])
})

it('rejects absent prerequisites, modified ownership, substituted captures and unauthorized index rows', async () => {
  const [all, { release, dispatch, ingestion }] = await Promise.all([scenarios, lineage])
  const broken = structuredClone(release)
  broken.identities[0].approval.owner = 'owner-2917'
  expect(failed(await evaluate('dispatch', route, broken))).toEqual(['release-required'])
  expect(failed(await evaluate('dispatch', route))).toEqual(['release-required'])
  const forged = structuredClone(dispatch)
  forged.evidence.capture[16] = 0
  forged.evidence.captureDigest = digest(Buffer.from(forged.evidence.capture))
  expect(failed(await evaluate('deframe', framing, forged))).toEqual(['dispatch-required'])
  expect(failed(await evaluate('deframe', framing))).toEqual(['dispatch-required'])
  const swapped = structuredClone(ingestion)
  const ack = swapped.evidence.frames[0].disposition
  if (ack.kind === 'accepted') ack.owner = 'owner-2917'
  expect(failed(await evaluate('mirror', reconciliation, swapped))).toEqual(['ingestion-required'])
  expect(failed(await evaluate('mirror', reconciliation))).toEqual(['ingestion-required'])
  const boundary = all.find(({ id }) => id === '009-the-boundary')!
  const dataset = structuredClone(boundary.recovery!.dataset)
  dataset.archive!.sources[1].archiveId = dataset.archive!.sources[0].archiveId
  expect(await engine.validateRecovery(dataset)).toMatchObject({
    ok: false,
    error: { code: 'invalid_program' },
  })
  await expect(
    evaluate('mirror', ['opaque', 'map:AR-1842=first,FAKE=other', '18.0'], ingestion),
  ).rejects.toThrow('Map every authorized source ID exactly once.')
  await expect(evaluate('deframe', [...framing.slice(0, 4), '7,7,4'], dispatch)).rejects.toThrow(
    'increasing interior byte offsets',
  )
  await expect(evaluate('capture', ['0', '129'], dispatch)).rejects.toThrow('between 1 and 128')
  expect(
    await engine.runRecovery({
      version: 1,
      dataset: boundary.recovery!.dataset,
      command: 'identifier',
      args: ['15.1', 'Ᲊ\ud800'],
    }),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input', path: 'args.1', offset: 1 } })
})

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  }
}

it('migrates completed release saves, restores read gates, and applies each handoff and delivery once', async () => {
  const [all, { release, dispatch, ingestion }] = await Promise.all([scenarios, lineage])
  const [releaseScenario, gateway, spool, bridge] = all.slice(5)
  for (const legacy of [undefined, { ...release, outbox: undefined }]) {
    const disk = memoryStorage()
    disk.setItem(
      campaignKey,
      JSON.stringify({
        version: 1,
        current: releaseScenario.id,
        completed: all.slice(0, 6).map(({ id }) => id),
        delivered: ['it-worked'],
        read: ['it-worked'],
        handoffs: legacy ? { [releaseScenario.id]: legacy } : undefined,
      } satisfies CampaignSnapshot),
    )
    let campaign = createCampaign(all, disk)
    expect(campaign.handoff(releaseScenario.id)).toEqual(release)
    expect(campaign.completed(releaseScenario.id)).toBe(true)
    expect(campaign.selectable(gateway.id)).toBe(true)
    expect(campaign.selectable(spool.id)).toBe(false)
    expect(
      campaign.delivered.filter((id) =>
        ['it-worked', 'thank-you', 'audit-receipts-queued'].includes(id),
      ),
    ).toEqual(['it-worked'])
    expect(
      errors(await createRuntime(releaseScenario, engine, campaign).dispatch({ type: 'commit' })),
    ).toEqual([])
    expect(campaign.handoff(releaseScenario.id)).toEqual(release)
    for (const [scenario, command, args, path, priorEvidence] of [
      [gateway, 'dispatch', route, '/reports/gateway.txt', dispatch],
      [spool, 'deframe', framing, '/reports/ingestion.txt', ingestion],
      [bridge, 'mirror', reconciliation, '/reports/reconciliation.txt', undefined],
    ] as const) {
      expect(campaign.enter(scenario.id)).toBe(true)
      let runtime = createRuntime(scenario, engine, campaign)
      const read = parseCommand('cat ' + path)!
      expect(errors(await runtime.dispatch(read))).not.toEqual([])
      for (let index = 0; index < 2; index++)
        expect(errors(await runtime.dispatch(puzzleAction(command, args)))).toEqual([])
      expect(campaign.completed(scenario.id)).toBe(false)
      expect(campaign.handoff(scenario.id)).toBeUndefined()
      const staged = runtime.snapshot()
      campaign = createCampaign(all, disk)
      runtime = createRuntime(scenario, engine, campaign, staged)
      expect(errors(await runtime.dispatch(read))).toEqual([])
      expect(campaign.completed(scenario.id)).toBe(true)
      const persisted = campaign.handoff(scenario.id)
      if (priorEvidence) expect(persisted).toEqual(priorEvidence)
      const mail = campaign.delivered
      campaign = createCampaign(all, disk)
      runtime = createRuntime(scenario, engine, campaign)
      await runtime.dispatch({ type: 'reset' })
      expect(runtime.state.completed).toBe(true)
      expect(errors(await runtime.dispatch(read))).toEqual([])
      expect(campaign.handoff(scenario.id)).toEqual(persisted)
      expect(campaign.delivered).toEqual(mail)
      expect(campaign.completed(releaseScenario.id)).toBe(true)
    }
    expect(campaign.selectable('010-the-needle')).toBe(true)
    const committed = extract(campaign.handoff(bridge.id), 'mirror')
    expect(
      failed(await evaluate('mirror', ['opaque', 'prefix:new_', '18.0'], ingestion, { committed })),
    ).toEqual(['stable-handles'])
    expect(
      failed(await evaluate('mirror', ['opaque', 'id', '15.1'], ingestion, { committed })),
    ).toEqual(['stable-index'])
    expect((await evaluate('mirror', reconciliation, ingestion, { committed })).handoff).toEqual(
      committed,
    )
    expect(campaign.reset()).toBe(all[0].id)
    expect(campaign.handoff(releaseScenario.id)).toBeUndefined()
    expect(campaign.selectable(gateway.id)).toBe(false)
  }
})
