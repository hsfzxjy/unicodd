import { expect, it } from 'vitest'
import { createCampaign } from '../src/lib/campaign'
import { parseCommand } from '../src/lib/commands'
import { createRuntime, type Action, type Output } from '../src/lib/runtime'
import { replayJournal } from '../src/lib/workspace'
import { engine, fixtures, production } from './scenario-content'

const transitions = (output: Output[] = []) =>
  output.flatMap((row) => ('progress' in row && row.progress ? [row.progress] : []))

it('reconstructs milestone rows from a journal without duplicating campaign receipts', async () => {
  const [entry] = await fixtures.manifest()
  const scenario = await fixtures.scenario(entry)
  const shelf = scenario.hosts[0]
  const index = shelf.resources.find(({ id }) => id === 'index')
  const reveal = index?.type === 'file' && index.onRead[0]
  const elevate = shelf.operations[0].success[0]
  if (!reveal || reveal.type !== 'flag' || elevate.type !== 'session')
    throw new Error('Expected the fixture’s flag and role effects.')
  reveal.milestone = { id: 'annex', title: 'Annex listed', text: 'The annex is now visible.' }
  elevate.milestone = { id: 'curator', title: 'Curator access', text: 'The exhibit is readable.' }
  scenario.objective.completionBand = true

  const campaign = createCampaign([scenario])
  const runtime = createRuntime(scenario, engine, campaign)
  expect(runtime.caseProgress).toEqual({
    steps: [{ label: scenario.objective.text, complete: false }],
    completed: 0,
    nextIndex: 0,
  })
  const start = { runtime: runtime.snapshot(), campaign: campaign.snapshot() }
  const actions: Action[] = [
    { type: 'cat', path: '/index' },
    { type: 'cat', path: '/index' },
    { type: 'login', alias: '🧪' },
    { type: 'connect', host: 'annex', scope: 'local' },
    { type: 'cat', path: '/document' },
    { type: 'cat', path: '/document' },
  ]
  const live = []
  for (const action of actions) live.push(transitions((await runtime.dispatch(action)).output))
  expect(live.map((rows) => rows.map(({ scope }) => scope))).toEqual([
    ['subobjective'],
    [],
    ['subobjective'],
    [],
    ['scenario'],
    [],
  ])

  const replay = await replayJournal(
    { start, welcome: true, commands: actions.map((action, index) => ({ id: index + 1, action })) },
    scenario,
    [scenario],
    engine,
  )
  expect(replay.entries.slice(1).map(({ output }) => transitions(output))).toEqual(live)
  expect(replay.entries.every((record) => !record.freshProgress)).toBe(true)

  const restored = createCampaign([scenario], undefined, undefined, campaign.snapshot())
  const reopened = createRuntime(scenario, engine, restored, runtime.snapshot())
  await reopened.dispatch({ type: 'reset' })
  expect(restored.completed(scenario.id)).toBe(true)
  expect(reopened.state.completed).toBe(false)
  expect(reopened.caseProgress).toMatchObject({ completed: 1, nextIndex: -1 })
  for (const action of actions)
    expect(transitions((await reopened.dispatch(action)).output)).toEqual([])
  expect(restored.snapshot().milestones).toHaveLength(2)

  await reopened.dispatch({ type: 'resetCampaign' })
  expect(restored.snapshot().milestones).toBeUndefined()
  expect(transitions((await reopened.dispatch(actions[0])).output)).toEqual(live[0])
})

it('counts both authentic receipts once and leaves the authorization read as the last step', async () => {
  const scenarios = await production.campaign(await production.manifest())
  const scenario = scenarios.find(({ id }) => id === '005-the-handshake')!
  const campaign = createCampaign(scenarios, undefined, scenario.id)
  let runtime = createRuntime(scenario, engine, campaign)
  const run = (command: string) => runtime.dispatch(parseCommand(command)!)

  expect(runtime.caseProgress).toMatchObject({ completed: 0, nextIndex: 0 })
  await run('lookup tr IRIS')
  await run('lookup tr IRIS')
  const saved = structuredClone(runtime.snapshot())
  const diagnostic = scenario.recovery!.dataset.receipts.find(({ diagnostic }) => diagnostic)!
  const receipts = saved.recovery?.['recovery-05'].context.receipts
  if (!Array.isArray(receipts)) throw new Error('Expected a staged receipt.')
  receipts.push(diagnostic.id)
  runtime = createRuntime(scenario, engine, campaign, saved)
  expect(runtime.caseProgress.steps[0]).toMatchObject({
    complete: false,
    detail: '1 of 2 receipts retrieved',
  })

  await run('lookup tr iris')
  expect(runtime.caseProgress).toMatchObject({ completed: 1, nextIndex: 1 })
  await run('bind registration RC-1842 RC-2917')
  expect(runtime.caseProgress).toMatchObject({ completed: 2, nextIndex: 2 })
  expect(campaign.progress.completed).toBe(0)
  await run('cat /outbox/authorization.txt')
  expect(campaign.progress.completed).toBe(1)
  await runtime.dispatch({ type: 'reset' })
  expect(runtime.caseProgress).toMatchObject({ completed: 3, nextIndex: -1 })
})

it('recalculates Release progress when a new plan invalidates the preview and dry run', async () => {
  const scenarios = await production.campaign(await production.manifest())
  const scenario = scenarios.find(({ id }) => id === '006-the-release')!
  const campaign = createCampaign(scenarios, undefined, scenario.id)
  const runtime = createRuntime(scenario, engine, campaign)
  const run = (command: string) => runtime.dispatch(parseCommand(command)!)

  await run('prepare registration preserve')
  await run('preview grapheme 4 isolate escape')
  await run('verify')
  expect(runtime.caseProgress).toMatchObject({ completed: 3, nextIndex: 3 })
  await run('prepare registration preserve')
  expect(runtime.caseProgress).toMatchObject({ completed: 1, nextIndex: 1 })
  await run('commit')
  expect(runtime.caseProgress).toMatchObject({ completed: 1, nextIndex: 1 })
  expect(campaign.progress.completed).toBe(0)
})
