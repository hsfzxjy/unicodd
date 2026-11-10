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
  const [relay, dead] = scenarios
  const disk = storage()
  let campaign = createCampaign(scenarios, disk)
  let runtime = createRuntime(relay, engine, campaign)
  const run = (command: string) => runtime.dispatch(parseCommand(command)!)
  expect(campaign.destinations()).toEqual([relay])
  expect(await run('scenario ' + dead.id)).toMatchObject({ output: [{ kind: 'error' }] })
  await run('connect relay-07')
  await run('login ＭＡＩＮＴ')
  expect(campaign.completed(relay.id)).toBe(false)
  await run('cat /queue/8c2f.msg')
  expect(campaign.destinations()).toEqual([relay, dead])
  await run('mail missing-notice')
  await runtime.dispatch({ type: 'reset' })
  expect(runtime.state.completed).toBe(false)
  expect(campaign.completed(relay.id)).toBe(true)
  await run('connect relay-07')
  await run('login ＭＡＩＮＴ')
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
  expect(await run('route Mira')).toMatchObject({
    output: [{ text: expect.stringContaining('under delivery hold') }],
  })
  expect(await run('route Other')).toMatchObject({
    output: [{ text: expect.stringContaining('could not be resolved') }],
  })
  await run(String.raw`route Mi\u00200B\u00200Bra`)
  expect(runtime.state.flags).toContain('released')
  expect(runtime.state.completed).toBe(false)
  await run('cat /delivered/2917.msg')
  expect(runtime.state.completed).toBe(true)
  await run('cat /delivered/2917.msg')
  expect(campaign.delivered).toEqual(['favor', 'missing-notice', 'spoke-to-her'])
  const restored = createCampaign(scenarios, disk)
  expect(restored.completed(dead.id)).toBe(true)
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
