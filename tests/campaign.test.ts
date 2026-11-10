import { expect, it } from 'vitest'
import { campaignKey, createCampaign } from '../src/lib/campaign'
import { parseCommand } from '../src/lib/commands'
import { createRuntime } from '../src/lib/runtime'
import { engine, production } from './scenario-content'

function storage() {
  const entries = new Map<string, string>()
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  }
}
const load = async () => production.campaign(await production.manifest())

it('keeps campaign progression and inbox separate from replayable sessions', async () => {
  const scenarios = await load()
  const [relay, dead, index] = scenarios
  const disk = storage()
  let campaign = createCampaign(scenarios, disk)
  let runtime = createRuntime(relay, engine, campaign)
  const run = (command: string) => runtime.dispatch(parseCommand(command)!)
  expect(campaign.destinations()).toEqual([relay])
  expect(await run('scenario ' + dead.id)).toMatchObject({ output: [{ kind: 'error' }] })
  await run('connect relay-07')
  await run('login \u{1D40C}AINT')
  expect(campaign.completed(relay.id)).toBe(false)
  await run('cat /queue/8c2f.msg')
  expect(campaign.destinations()).toEqual([relay, dead])
  await run('mail missing-notice')
  await runtime.dispatch({ type: 'reset' })
  expect(runtime.state.completed).toBe(false)
  expect(campaign.completed(relay.id)).toBe(true)
  await run('connect relay-07')
  await run('login \u{1D40C}AINT')
  expect((await run('cat /queue/8c2f.msg')).output?.map(({ kind }) => kind)).toEqual([
    'file',
    'objective',
  ])
  campaign = createCampaign(scenarios, disk)
  expect(campaign.read).toEqual(['missing-notice'])
  expect(campaign.delivered).toEqual(['favor', 'missing-notice'])
  expect(campaign.current).toBe(relay.id)
  expect(
    await createRuntime(relay, engine, campaign).dispatch({ type: 'scenario', id: dead.id }),
  ).toEqual({ enter: dead.id })
  campaign.enter(dead.id)
  campaign = createCampaign(scenarios, disk)
  expect(campaign.current).toBe(dead.id)
  runtime = createRuntime(dead, engine, campaign)
  expect(runtime.state.identity.role).toBe('guest')
  expect(await run('cat /spool/2917.msg')).toMatchObject({ output: [{ kind: 'file' }] })
  expect(await run('cat /delivered/2917.msg')).toMatchObject({ output: [{ kind: 'error' }] })
  expect(await run('route')).toEqual({ edit: true })
  expect(await run('route Mira Mira')).toMatchObject({
    output: [{ text: expect.stringContaining('under delivery hold') }],
  })
  expect(await run('route Other Mira')).toMatchObject({
    output: [{ text: expect.stringContaining('could not be resolved') }],
  })
  await run(String.raw`route Mi\u00200Bra \u00FF2Dira`)
  expect(runtime.state.flags).toContain('released')
  expect(runtime.state.completed).toBe(false)
  await run('cat /delivered/2917.msg')
  expect(runtime.state.completed).toBe(true)
  await run('cat /delivered/2917.msg')
  expect(campaign.delivered).toEqual(['favor', 'missing-notice', 'missing-notice-reply'])
  campaign = createCampaign(scenarios, disk)
  expect(campaign.completed(dead.id)).toBe(true)
  expect(campaign.selectable(index.id)).toBe(true)
  expect(campaign.enter(index.id)).toBe(true)
  runtime = createRuntime(index, engine, campaign)
  expect(runtime.state.identity.role).toBe('auditor')
  expect(await run('cat /audit/identifier-review.txt')).toMatchObject({
    output: [{ kind: 'file', text: expect.stringContaining('Script profile: Mixed') }],
  })
  const exportPath = 'cat /exports/8c2f-originals.json'
  expect(await run(exportPath)).toMatchObject({ output: [{ kind: 'error' }] })
  expect(await run('reconcile')).toEqual({ edit: true })
  expect(await run('reconcile Mira')).toMatchObject({
    output: [{ text: expect.stringContaining('Protected canonical identifier') }],
  })
  expect(await run('reconcile Other')).toMatchObject({
    output: [{ text: expect.stringContaining('No matching collision record') }],
  })
  const candidate = '\u039cira'
  await run('reconcile ' + candidate)
  expect(runtime.state.flags).toEqual(['bucket_found'])
  expect(await run(exportPath)).toMatchObject({ output: [{ kind: 'error' }] })
  expect(await run('reconstruct Mira ' + candidate)).toMatchObject({
    output: [{ text: 'Registration B: spelling differs from the verified source.' }],
  })
  await run(String.raw`reconstruct Mira M\u000456ra`)
  expect(runtime.state.flags).toContain('export_ready')
  expect(runtime.state.completed).toBe(false)
  expect(campaign.finished).toBe(false)
  const output = (await run(exportPath)).output
  const file = output?.[0]
  if (file?.kind !== 'file') throw new Error('Expected the diagnostic export')
  const records = JSON.parse(file.text).records
  expect(records).toEqual([
    {
      id: '0001842',
      name: 'Mira',
      codepoints: ['U+004D', 'U+0069', 'U+0072', 'U+0061'],
      verified: true,
    },
    {
      id: '0002917',
      name: 'M\u0456ra',
      codepoints: ['U+004D', 'U+0456', 'U+0072', 'U+0061'],
      verified: true,
    },
  ])
  expect(campaign.finished).toBe(true)
  expect(await run(exportPath)).toMatchObject({ output: [{ kind: 'file' }] })
  await runtime.dispatch({ type: 'reset' })
  await run(String.raw`reconcile M\u000456ra`)
  await run(String.raw`reconstruct Mira M\u000456ra`)
  expect((await run(exportPath)).output?.map(({ kind }) => kind)).toEqual(['file', 'objective'])
  const restored = createCampaign(scenarios, disk)
  expect(restored.current).toBe(index.id)
  expect(restored.finished).toBe(true)
  expect(restored.delivered).toEqual([
    'favor',
    'missing-notice',
    'missing-notice-reply',
    'spoke-to-her',
    'we-have-the-records',
  ])
  expect(restored.reset()).toBe(relay.id)
  expect(restored.delivered).toEqual(['favor'])
  expect(restored.destinations()).toEqual([relay])
  expect(createCampaign(scenarios, disk).completed(relay.id)).toBe(false)
})

it('migrates Relay completion from Milestone 003 and handles malformed or old campaign saves', async () => {
  const scenarios = await load()
  const [relay, dead] = scenarios
  const disk = storage()
  disk.setItem('unicodd.objective.' + relay.id, 'true')
  const migrated = createCampaign(scenarios, disk)
  expect(migrated.completed(relay.id)).toBe(true)
  expect(migrated.selectable(dead.id)).toBe(true)
  expect(migrated.delivered).toEqual(['favor', 'missing-notice'])
  for (const malformed of ['{', '{"version":0}', '{"version":1,"completed":42}']) {
    disk.setItem(campaignKey, malformed)
    const fresh = createCampaign(scenarios, disk)
    expect(fresh.current).toBe(relay.id)
    expect(fresh.selectable(dead.id)).toBe(false)
    expect(fresh.delivered).toEqual(['favor'])
  }
  expect(createCampaign(scenarios, undefined, dead.id).current).toBe(dead.id)
})
