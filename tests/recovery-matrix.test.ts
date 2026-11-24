import { mkdir, writeFile } from 'node:fs/promises'
import { afterAll, expect, it } from 'vitest'
import { campaignKey, createCampaign } from '../src/lib/campaign'
import { parseCommand, puzzleAction } from '../src/lib/commands'
import type { Handoff, RecoveryCommand, RecoveryContext, RecoveryReport } from '../src/lib/recovery'
import { createRuntime } from '../src/lib/runtime'
import { inspect } from '../src/lib/unicode'
import matrix from './fixtures/recovery-matrix.json'
import { engine, production } from './scenario-content'

const scenarios = production.manifest().then(production.campaign)
const results = new Map<string, unknown>()

afterAll(async () => {
  if (process.env.UPDATE_PUZZLE_MATRIX !== '1') return
  const path = new URL('../private/testing/', import.meta.url)
  await mkdir(path, { recursive: true })
  const details = matrix.cases.map((vector) => ({ ...vector, actual: results.get(vector.id) }))
  await writeFile(
    new URL('recovery-regression-matrix.json', path),
    JSON.stringify(
      {
        versions: matrix.versions,
        cases: details,
      },
      null,
      2,
    ) + '\n',
  )
})

it('pins the Unicode data behind the recovery matrix', async () => {
  expect(await engine.info()).toMatchObject({ ok: true, value: matrix.versions })
})

it.each(matrix.cases)('$scenario · $id', async (vector) => {
  const all = await scenarios
  const scenario = structuredClone(all.find(({ id }) => id === vector.scenario)!)
  const dataset = scenario.recovery!.dataset
  if (vector.rollbackReady === false) Object.assign(dataset, { rollbackReady: false })
  const campaign = createCampaign(all, undefined, scenario.id)
  const runtime = createRuntime(scenario, engine, campaign)
  let context: RecoveryContext | undefined
  let committed: Handoff | undefined

  async function run(command: RecoveryCommand, args: string[]) {
    const result = await engine.runRecovery({
      version: 1,
      dataset,
      command,
      args,
      context,
      committed,
      direct: true,
    })
    if (!result.ok) throw new Error(result.error.message)
    context = result.value.context
    if (result.value.handoff?.kind === 'release') committed = result.value.handoff
    const response = await runtime.dispatch(puzzleAction(command, args))
    return { report: result.value, output: response.output ?? [] }
  }

  for (const [command, ...args] of vector.setup ?? []) {
    await run(command as RecoveryCommand, args)
  }
  const { report, output } = await run(vector.command as RecoveryCommand, vector.args)
  expect(report.solved).toBe(vector.failed.length === 0)
  expect(report.checks.filter(({ passed }) => !passed).map(({ id }) => id)).toEqual(vector.failed)
  expect(output.some(({ kind }) => kind === 'error')).toBe(!report.solved)
  expect(report.handoff?.kind).toBe(vector.handoff)
  if (vector.diagnostic)
    expect(output.flatMap((row) => ('text' in row ? [row.text] : [])).join('\n')).toContain(
      vector.diagnostic,
    )
  if (vector.flags) expect(runtime.state.flags).toEqual(vector.flags)
  for (const [label, ...fields] of vector.rows ?? [])
    expect(report.rows).toContainEqual(expect.objectContaining({ label, fields }))
  for (const [label, ...details] of vector.notes ?? [])
    expect(report.rows).toContainEqual(expect.objectContaining({ label, details }))
  for (const { text, points } of vector.points)
    expect(inspect(text).map(({ notation }) => notation)).toEqual(points)
  if (report.handoff?.kind === 'release') {
    expect(report.handoff.identities.map(({ name }) => name)).toEqual(['Mira', 'Mіra'])
    expect(report.handoff.identities.map(({ canonical }) => canonical)).toEqual([
      '0001842',
      '0002917',
    ])
  }
  if (vector.id === 'safe-audit') {
    const lines = report.rows
      .filter(({ serialized }) => serialized)
      .map(({ serialized }) => serialized)
    expect(lines).toEqual([
      'CASE \u2068Cafe\u0301\u2069 0002917 STATE APPROVED',
      'CASE \u2068abc👩‍💻\u2069 0002917 STATE APPROVED',
      'CASE \u2068تمت \u2069 0002917 STATE APPROVED',
      'CASE \u2068ok[U+202E]1\u2069 0002917 STATE APPROVED',
    ])
  }
  if (vector.command === 'commit') {
    expect(campaign.delivered.filter((id) => ['it-worked', 'thank-you'].includes(id))).toEqual(
      report.solved ? ['it-worked', 'thank-you'] : [],
    )
    expect(runtime.state.completed).toBe(report.solved)
  }
  results.set(vector.id, {
    report,
    output,
    flags: runtime.state.flags,
    delivered: campaign.delivered,
  })
})

it('round-trips a cursor and rejects mismatched parameters or incomplete resumption', async () => {
  const [, , , backlog] = await scenarios
  const dataset = backlog.recovery!.dataset
  const run = async (args: string[]): Promise<RecoveryReport> => {
    const result = await engine.runRecovery({ version: 1, dataset, command: 'replay', args })
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const settings = ['sv-SE', 'tertiary', 'composite', '1']
  const full = await run([...settings, 'start'])
  const cursor = full.rows[0].serialized!
  expect(JSON.parse(cursor)).toMatchObject({ record: 'AP-1842', key: expect.any(Array) })
  const titleOnly = await run(['sv-SE', 'tertiary', 'title', '1', 'start'])
  expect(JSON.parse(titleOnly.rows[0].serialized!)).not.toHaveProperty('record')
  const resumed = await run([...settings, cursor])
  expect(resumed.rows[0].fields).toEqual(['AP-T001'])
  expect(resumed.checks.filter(({ passed }) => !passed)).toMatchObject([
    { id: 'complete-traversal' },
  ])
  expect((await run(['en-US', ...settings.slice(1), cursor])).checks).toMatchObject([
    { id: 'cursor-profile', passed: false },
  ])
  const foreign = JSON.stringify({ ...JSON.parse(cursor), key: [0] })
  expect((await run([...settings, foreign])).checks).toMatchObject([
    { id: 'cursor-profile', passed: false },
  ])
})

it('rejects malformed UTF-16 at the recovery bridge before encoding', async () => {
  const [, , , backlog] = await scenarios
  expect(
    await engine.runRecovery({
      version: 1,
      dataset: backlog.recovery!.dataset,
      command: 'collate',
      args: ['sv-SE', 'tertiary', '👩\ud800', 'A'],
    }),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input', path: 'args.2', offset: 2 } })
})

it('continues a pre-Recovery save and persists evidence through the atomic release', async () => {
  const all = await scenarios
  const [relay, dead, index, backlog, handshake, release] = all
  const values = new Map<string, string>()
  const disk = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
  disk.setItem(
    campaignKey,
    JSON.stringify({
      version: 1,
      current: index.id,
      completed: [relay.id, dead.id, index.id],
      delivered: [
        'favor',
        'missing-notice',
        'missing-notice-reply',
        'spoke-to-her',
        'we-have-the-records',
      ],
      read: ['we-have-the-records'],
    }),
  )
  let campaign = createCampaign(all, disk)
  expect(campaign.current).toBe(index.id)
  expect(campaign.destinations()).toEqual([relay, dead, index, backlog])
  expect(campaign.delivered.filter((id) => id === 'reopened-both-cases')).toHaveLength(1)
  expect(campaign.read).toEqual(['we-have-the-records'])

  async function play(id: string, commands: string[]) {
    expect(campaign.enter(id)).toBe(true)
    const runtime = createRuntime(
      all.find((scenario) => scenario.id === id)!,
      engine,
      campaign,
    )
    for (const command of commands) {
      const response = await runtime.dispatch(parseCommand(command)!)
      expect(
        response.output?.filter((row) => row.kind === 'error'),
        command,
      ).toEqual([])
    }
    return runtime
  }

  await play(backlog.id, [
    'replay en-US primary composite 1 start',
    'recover AP-1842 AP-2917',
    'cat /outbox/review-handoff.txt',
  ])
  campaign = createCampaign(all, disk)
  expect(campaign.handoff(backlog.id)?.kind).toBe('appeals')
  await play(handshake.id, [
    'lookup tr IRIS',
    'lookup tr iris',
    'bind registration RC-1842 RC-2917',
    'cat /outbox/authorization.txt',
  ])
  campaign = createCampaign(all, disk)
  expect(campaign.handoff(handshake.id)?.kind).toBe('approvals')
  const runtime = await play(release.id, [
    'prepare registration preserve',
    'preview grapheme 4 isolate escape',
    'verify',
  ])
  expect(campaign.finished).toBe(false)
  expect(campaign.handoff(release.id)).toBeUndefined()
  const [first, concurrent] = await Promise.all([
    runtime.dispatch({ type: 'commit' }),
    runtime.dispatch({ type: 'commit' }),
  ])
  expect(first.output?.some(({ kind }) => kind === 'objective')).toBe(true)
  expect(concurrent.output).toEqual([{ kind: 'error', text: 'An action is in progress.' }])
  expect(campaign.finished).toBe(false)
  expect(campaign.completed(release.id)).toBe(true)
  expect(campaign.selectable('007-the-other-side')).toBe(true)
  const committed = campaign.handoff(release.id)
  expect(committed?.kind).toBe('release')

  campaign = createCampaign(all, disk)
  expect(campaign.handoff(release.id)).toEqual(committed)
  expect(campaign.finished).toBe(false)
  expect(campaign.completed(release.id)).toBe(true)
  const restored = await play(release.id, ['local mail it-worked', 'commit'])
  expect(restored.state.completed).toBe(true)
  expect(campaign.read).toContain('it-worked')
  expect(campaign.readResources).not.toHaveLength(0)
  await restored.dispatch({ type: 'reset' })
  expect(restored.state.completed).toBe(true)
  expect(restored.state.flags).toContain('released')
  expect(campaign.delivered.filter((id) => ['it-worked', 'thank-you'].includes(id))).toEqual([
    'it-worked',
    'thank-you',
  ])
  const restarted = createCampaign(all, disk)
  expect(restarted.read).toEqual([])
  expect(restarted.readResources).toEqual([])
})

it('requires real handoffs outside isolated developer entry', async () => {
  const all = await scenarios
  const [, , , , handshake, release] = all
  const runtime = createRuntime(handshake, engine, createCampaign(all))
  for (const channel of ['IRIS', 'iris'])
    await runtime.dispatch(puzzleAction('lookup', ['tr', channel]))
  expect(
    (await runtime.dispatch(puzzleAction('bind', ['registration', 'RC-1842', 'RC-2917']))).output,
  ).toContainEqual({ kind: 'error', text: 'The broker needs the verified appeals handoff.' })
  expect(
    (
      await createRuntime(release, engine, createCampaign(all)).dispatch(
        puzzleAction('prepare', ['registration', 'preserve']),
      )
    ).output,
  ).toContainEqual({
    kind: 'error',
    text: 'The authorization handoff is missing or does not match both owners.',
  })
})

it('rechecks rollback readiness at commit and applies neither identity on failure', async () => {
  const all = await scenarios
  const release = structuredClone(all.find(({ id }) => id === '006-the-release')!)
  const campaign = createCampaign(all, undefined, release.id)
  const runtime = createRuntime(release, engine, campaign)
  for (const command of [
    'prepare registration preserve',
    'preview grapheme 4 isolate escape',
    'verify',
  ]) {
    const response = await runtime.dispatch(parseCommand(command)!)
    expect(response.output?.some(({ kind }) => kind === 'error')).toBe(false)
  }
  expect(runtime.state.flags).toContain('plan_verified')
  Object.assign(release.recovery!.dataset, { rollbackReady: false })
  expect((await runtime.dispatch({ type: 'commit' })).output).toContainEqual({
    kind: 'error',
    text: 'Rollback readiness check failed. Nothing has been applied.',
  })
  expect(campaign.handoff(release.id)).toBeUndefined()
  expect(campaign.completed(release.id)).toBe(false)
  expect(runtime.state.flags).not.toContain('released')
  expect(campaign.delivered).not.toContain('it-worked')
})
