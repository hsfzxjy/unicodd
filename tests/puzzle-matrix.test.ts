import { mkdir, writeFile } from 'node:fs/promises'
import { afterAll, expect, it } from 'vitest'
import vectors from './fixtures/puzzle-matrix.json'
import { puzzleAction } from '../src/lib/commands'
import { createRuntime } from '../src/lib/runtime'
import type { PuzzleCommand } from '../src/lib/scenario'
import { notation } from '../src/lib/unicode'
import { engine, production } from './scenario-content'

const campaign = production.manifest().then(production.campaign)
const calculated: string[] = []

it.each(vectors)('$scenario / $command / $name', async (vector) => {
  const scenario = structuredClone((await campaign).find(({ id }) => id === vector.scenario)!)
  const host = scenario.hosts[0]
  const command = vector.command as PuzzleCommand
  const binding = host.operations.find((item) => item.command === command)!
  const inputs: Record<string, string> = Object.fromEntries(
    Object.entries(vector.inputs).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
  const evaluated = await engine.evaluate(binding.program, inputs, true)
  if (!evaluated.ok) throw new Error(evaluated.error.message)
  expect(evaluated.value.solved).toBe(vector.solved)
  const trace = new Map(evaluated.value.trace?.map(({ id, result }) => [id, result.value]))
  const intermediate = Object.entries(vector.trace).filter(([, value]) => value !== undefined)
  for (const [id, value] of intermediate) expect(trace.get(id), id).toBe(value)
  expect(
    Object.fromEntries(
      evaluated.value.checks.map(({ id, actual, expected }) => [id, { actual, expected }]),
    ),
  ).toEqual(vector.conditions)

  // Fixed fields normally come from production content. Exercise corrupted/swapped bindings
  // through the same dispatcher so the graph also protects the association.
  for (const field of binding.fields)
    if (field.fixed !== undefined) field.fixed = inputs[field.input]
  const runtime = createRuntime(scenario, engine)
  if (!runtime.state.host) await runtime.dispatch({ type: 'connect', host: host.id })
  const action = puzzleAction(
    command,
    binding.fields.filter(({ fixed }) => fixed === undefined).map(({ input }) => inputs[input]),
  )
  if (command === 'reconstruct') {
    expect(await runtime.dispatch(action)).toMatchObject({
      output: [{ kind: 'error', text: expect.stringContaining('unavailable') }],
    })
    await runtime.dispatch(puzzleAction('reconcile', ['Μira']))
    expect(runtime.state.flags).toEqual(['bucket_found'])
  }
  const before = runtime.state
  const response = await runtime.dispatch(action)
  expect(response.output?.[0]).toEqual({
    kind: !vector.solved ? 'error' : command === 'login' ? 'auth' : 'message',
    text: vector.feedback,
  })
  expect(runtime.state.completed).toBe(false)
  if (!vector.solved) expect(runtime.state).toBe(before)
  else {
    switch (command) {
      case 'login':
        expect(runtime.state.identity.role).toBe('maintenance')
        break
      case 'route':
        expect(runtime.state.flags).toEqual(['released'])
        break
      case 'reconcile':
        expect(runtime.state.flags).toEqual(['bucket_found'])
        expect(runtime.operations.map(({ command }) => command)).toContain('reconstruct')
        break
      case 'reconstruct':
        expect(runtime.state.flags).toEqual(['bucket_found', 'export_ready'])
        break
    }
  }
  const sessionAfter = runtime.state
  const objective = host.resources.find(({ id }) => id === scenario.objective.read)!
  const mayRead = vector.solved && command !== 'reconcile'
  const opened = await runtime.dispatch({ type: 'cat', path: objective.path })
  expect(opened.output?.[0].kind === 'error').toBe(!mayRead)
  expect(runtime.state.completed).toBe(mayRead)

  const codePoints = (text: string) =>
    Array.from(text, (ch) => notation(ch.codePointAt(0)!)).join(' ')
  calculated[vectors.indexOf(vector)] = [
    `### ${vector.scenario} / ${command} / ${vector.name}`,
    '',
    vector.principle,
    '',
    ...Object.entries(inputs).map(
      ([id, text]) => `- ${id} = ${JSON.stringify(text)} · ${codePoints(text) || '(empty)'}`,
    ),
    ...intermediate.map(([id]) => `- ${id} = ${JSON.stringify(trace.get(id))}`),
    ...evaluated.value.checks.map(
      ({ id, actual, expected, passed }) =>
        `- ${id} · actual ${actual} · expected ${expected} · ${passed ? 'pass' : 'fail'}`,
    ),
    `- State after submission · access ${sessionAfter.identity.role} · flags ${sessionAfter.flags.join(', ') || '(none)'}`,
    `- Outcome · ${vector.solved ? 'accepted' : 'rejected'} · ${vector.feedback.replaceAll('\n', ' / ')}`,
  ].join('\n')
})

afterAll(async () => {
  if (process.env.UPDATE_PUZZLE_MATRIX !== '1') return
  if (calculated.filter(Boolean).length !== vectors.length)
    throw new Error('Matrix contains unverified rows.')
  const dir = new URL('../private/testing/', import.meta.url)
  await mkdir(dir, { recursive: true })
  const info = await engine.info()
  await writeFile(
    new URL('puzzle-regression-matrix.md', dir),
    [
      '# Puzzle regression matrix',
      'Generated by the puzzle matrix tests from checked fixtures and actual Rust/WASM traces. Regenerate with UPDATE_PUZZLE_MATRIX=1 and run the puzzle-matrix test file.',
      `Engine data · ${JSON.stringify(info)}`,
      'Integrity checks exercise all five mathematical-bold positions in The Relay and twelve valid header/envelope placements in Dead Letter, rejecting either spelling copied into both fields. In The Index, the retained lead byte distinguishes the surfaced Cyrillic candidates and the verifier also rejects two records assigned to one owner.',
      ...calculated,
    ].join('\n\n') + '\n',
  )
})

it('accepts valid alternative placements and rejects sharing a recipient across pipelines', async () => {
  const [relay, dead] = await campaign
  const login = relay.hosts[0].operations[0].program
  const route = dead.hosts[0].operations[0].program
  for (const [index, letter] of Array.from('MAINT').entries()) {
    const styled = String.fromCodePoint(0x1d400 + letter.charCodeAt(0) - 65)
    const alias = 'MAINT'.slice(0, index) + styled + 'MAINT'.slice(index + 1)
    expect(await engine.evaluate(login, { alias }), alias).toMatchObject({
      ok: true,
      value: { solved: true },
    })
  }
  for (const position of [1, 2, 3]) {
    const header = 'Mira'.slice(0, position) + '\u200b' + 'Mira'.slice(position)
    for (const [index, letter] of Array.from('Mira').entries()) {
      const wide = String.fromCodePoint(letter.charCodeAt(0) + 0xfee0)
      const envelope = 'Mira'.slice(0, index) + wide + 'Mira'.slice(index + 1)
      expect(
        await engine.evaluate(route, { header, envelope }),
        JSON.stringify({ header, envelope }),
      ).toMatchObject({
        ok: true,
        value: { solved: true },
      })
      for (const same of [header, envelope])
        expect(await engine.evaluate(route, { header: same, envelope: same }), same).toMatchObject({
          ok: true,
          value: { solved: false },
        })
    }
  }
})

it('cross-checks the retained byte evidence against the export and the terminal candidates', async () => {
  const index = (await campaign)[2]
  const host = index.hosts[0]
  const file = (id: string) => {
    const item = host.resources.find((resource) => resource.id === id)
    if (item?.type !== 'file') throw new Error('Expected audit file ' + id)
    return item.text
  }
  const [a, b]: { id: string; name: string; verified: boolean }[] = JSON.parse(
    file('originals'),
  ).records
  const bytes = new TextEncoder()
  const aBytes = bytes.encode(a.name)
  const bBytes = bytes.encode(b.name)
  const difference = aBytes.findIndex((byte, offset) => byte !== bBytes[offset])
  const lead = bBytes[difference]
  expect(file('encoding_log')).toContain(`${a.id}  ${aBytes.length} UTF-8 bytes  ASCII`)
  expect(file('encoding_log')).toContain(`${b.id}  ${bBytes.length} UTF-8 bytes  Latin + Cyrillic`)
  expect(file('difference')).toContain(`First different byte offset: ${difference} (zero-based)`)
  expect(file('difference')).toContain(
    `byte at offset ${difference}: ${lead.toString(16).toUpperCase()} (hex)`,
  )
  const inspection = await engine.inspectScalar(a.name[difference])
  if (!inspection.ok) throw new Error(inspection.error.message)
  const candidates = inspection.value.confusables.filter(
    ({ scalar, script }) => script === 'Cyrillic' && bytes.encode(scalar).length === 2,
  )
  expect(candidates.length).toBeGreaterThan(1)
  expect(
    candidates.filter(({ scalar }) => bytes.encode(scalar)[0] === lead).map(({ scalar }) => scalar),
  ).toEqual([b.name[difference]])
  const binding = host.operations.find(({ command }) => command === 'reconstruct')!
  const inputs = { id_a: a.id, id_b: b.id, name_a: a.name, name_b: b.name }
  expect(await engine.evaluate(binding.program, inputs)).toMatchObject({
    ok: true,
    value: { solved: true },
  })
  // Exact names and IDs still require two distinct verified owner records.
  const sameOwner = structuredClone(binding.program)
  const secondOwner = sameOwner.nodes.find(({ id }) => id === 'verified_owner_b')
  if (secondOwner?.op !== 'literal') throw new Error('Expected the owner record')
  secondOwner.value = { type: 'text', value: 'owner-1842' }
  expect(await engine.evaluate(sameOwner, inputs)).toMatchObject({
    ok: true,
    value: {
      solved: false,
      checks: expect.arrayContaining([
        { id: 'owners', actual: false, expected: true, passed: false, required: true },
      ]),
    },
  })
})
