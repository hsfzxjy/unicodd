import { expect, it } from 'vitest'
import { createCampaign } from '../src/lib/campaign'
import { createRuntime, type Action, type Output } from '../src/lib/runtime'
import { replayJournal } from '../src/lib/workspace'
import { engine, fixtures } from './scenario-content'

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
  const start = { runtime: runtime.snapshot(), campaign: campaign.snapshot() }
  const actions: Action[] = [
    { type: 'cat', path: '/index' },
    { type: 'cat', path: '/index' },
    { type: 'login', alias: '🧪' },
    { type: 'connect', host: 'annex' },
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
  for (const action of actions)
    expect(transitions((await reopened.dispatch(action)).output)).toEqual([])
  expect(restored.snapshot().milestones).toHaveLength(2)

  await reopened.dispatch({ type: 'resetCampaign' })
  expect(restored.snapshot().milestones).toBeUndefined()
  expect(transitions((await reopened.dispatch(actions[0])).output)).toEqual(live[0])
})
