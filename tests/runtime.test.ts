import { expect, it } from 'vitest'
import { createRuntime, linkStatus } from '../src/lib/runtime'
import { parseCommand, actionCommand, matchSuggestions } from '../src/lib/commands'
import { engine, fixtures, production } from './scenario-content'

const relay = async () => production.scenario((await production.manifest())[0])
const connect = { type: 'connect', host: 'relay-07' } as const
const incident = { type: 'cat', path: '/queue/8c2f.msg' } as const
const login = (alias: string) => ({ type: 'login', alias }) as const
const compatible = '\u{1D40C}AINT'

it('decodes command escapes without reinterpreting the resulting characters as syntax', () => {
  expect(parseCommand(String.raw`inspect \u01F9EA`)).toEqual({ type: 'inspect', character: '🧪' })
  expect(parseCommand(String.raw`login "a\u000022\u000020b"`)).toEqual(login('a" b'))
  expect(parseCommand(String.raw`login \u00000A`)).toEqual(login('\n'))
  expect(parseCommand(String.raw`login \\u000041`)).toEqual(login(String.raw`\u000041`))
  expect(parseCommand(String.raw`login \u00005Cu000041`)).toEqual(login(String.raw`\u000041`))
  expect(parseCommand(String.raw`inspect \u110000`)).toMatchObject({ type: 'invalid' })
})

it('completes paths in the requested style and quotes spaces when needed', () => {
  const candidates = ['cat "/exhibit/sample card"', 'ls /exhibit']
  expect(matchSuggestions('cat ex', candidates)).toEqual(['cat "exhibit/sample card"'])
  expect(matchSuggestions('cat "./exhibit/sample ', candidates)).toEqual([
    'cat "./exhibit/sample card"',
  ])
  expect(matchSuggestions('cat "/ex', candidates)).toEqual(['cat "/exhibit/sample card"'])
  expect(matchSuggestions('cat exhibit extra', candidates)).toEqual([])
  expect(matchSuggestions('ls ex', candidates)).toEqual(['ls exhibit'])
})

it('checks permissions, elevates through WASM, and completes only on authorized read', async () => {
  const runtime = createRuntime(await relay(), engine)
  expect(runtime.state).toMatchObject({
    host: undefined,
    identity: { user: 'guest' },
    completed: false,
  })
  const local = runtime.state
  expect(await runtime.dispatch({ type: 'connect', host: 'unknown' })).toMatchObject({
    output: [{ kind: 'error' }],
  })
  expect(runtime.state).toBe(local)
  await runtime.dispatch(connect)
  const guest = runtime.state
  expect(await runtime.dispatch({ type: 'ls', path: 'queue/' })).toMatchObject({
    output: [
      { kind: 'listing', path: '/queue', links: [{ detail: 'restricted', action: incident }] },
    ],
  })
  expect(await runtime.dispatch(incident)).toMatchObject({
    output: [{ kind: 'error', text: expect.stringContaining('Permission denied') }],
  })
  expect(await runtime.dispatch({ type: 'cat', path: '/missing' })).toMatchObject({
    output: [{ kind: 'error' }],
  })
  expect(runtime.state).toBe(guest)
  for (const [alias, failure] of [
    ['MAINT', 'Reserved account name'],
    ['\u{1D40C}AINX', 'Account not found'],
    ['\ud800', 'unpaired surrogate'],
  ]) {
    expect((await runtime.dispatch(login(alias))).output).toEqual([
      { kind: 'error', text: expect.stringContaining(failure) },
    ])
    expect(runtime.state).toBe(guest)
  }
  expect(await runtime.dispatch(login(compatible))).toMatchObject({
    output: [
      { kind: 'auth' },
      { kind: 'listing', links: [{ action: incident }] },
      { kind: 'milestone', progress: { scope: 'subobjective', action: 'login' } },
    ],
  })
  expect(runtime.state).toMatchObject({
    identity: { user: 'MAINT', role: 'maintenance' },
    completed: false,
  })
  expect((await runtime.dispatch(incident)).output).toMatchObject([
    { kind: 'file' },
    { kind: 'objective' },
    {
      kind: 'listing',
      title: 'New mail',
      links: [{ action: { type: 'mail', id: 'missing-notice' } }],
    },
  ])
  expect(runtime.state.completed).toBe(true)
  expect((await runtime.dispatch(incident)).output?.map((item) => item.kind)).toEqual(['file'])
  await runtime.dispatch({ type: 'logout' })
  expect(runtime.state.identity).toEqual(guest.identity)
  await runtime.dispatch(login('M\u{1D400}INT'))
  expect(runtime.state.identity.role).toBe('maintenance')
  await runtime.dispatch(connect)
  expect(runtime.state.identity).toEqual(guest.identity)
  expect(runtime.state.completed).toBe(true)
  expect(await runtime.dispatch({ type: 'clear' })).toEqual({ clear: true })
  expect(runtime.state.completed).toBe(true)
  await runtime.dispatch({ type: 'reset' })
  expect(runtime.state).toEqual({
    ...local,
    deliveredMail: ['favor', 'missing-notice'],
    visitedHosts: ['001-the-relay/relay-07'],
    readResources: ['001-the-relay/relay-07/incident'],
  })
})

it('uses guards and effects for a differently structured fixture', async () => {
  const scenario = await fixtures.scenario((await fixtures.manifest())[0])
  const runtime = createRuntime(scenario, engine)
  expect(runtime.state.host?.id).toBe('shelf')
  const annex = { type: 'connect', host: 'annex' } as const
  const card = { type: 'cat', path: '/exhibit/sample card' } as const
  const archive = { type: 'cat', path: '/exhibit/sealed' } as const
  const inbox = { type: 'mail' } as const
  const delivery = { type: 'mail', id: 'fixture-arrival' } as const
  expect(runtime.welcome().some(({ kind }) => kind === 'mailNotice')).toBe(false)
  expect((await runtime.dispatch(inbox)).output).toMatchObject([{ kind: 'listing', links: [] }])
  expect((await runtime.dispatch(delivery)).output?.[0].kind).toBe('error')
  expect((await runtime.dispatch(annex)).output?.[0].kind).toBe('error')
  expect((await runtime.dispatch(card)).output).toEqual([
    { kind: 'error', text: expect.stringContaining('No such resource') },
  ])
  expect((await runtime.dispatch(login('🧪'))).output?.[0].kind).toBe('error')
  const index = { type: 'cat', path: 'index' } as const
  expect((await runtime.dispatch(index)).output).toMatchObject([
    { kind: 'file' },
    { kind: 'message' },
    { kind: 'listing', title: 'New mail', links: [{ action: delivery }] },
  ])
  expect((await runtime.dispatch(index)).output?.map(({ kind }) => kind)).toEqual([
    'file',
    'message',
  ])
  const list = (await runtime.dispatch(inbox)).output?.[0]
  if (list?.kind !== 'listing') throw new Error('Expected an inbox listing')
  expect(list.links[0].action).toEqual(delivery)
  expect(linkStatus(list.links[0], runtime.state)).toBe('Unread')
  const delivered = await runtime.dispatch(delivery)
  expect(delivered.output).toMatchObject([{ kind: 'mail', messages: [{ date: '2026-01-01' }] }])
  expect(await runtime.dispatch(delivery)).toEqual(delivered)
  expect(runtime.state.readMail).toEqual(['fixture-arrival'])
  expect(linkStatus(list.links[0], runtime.state)).toBe('Read')
  expect(runtime.suggestions()).toContain('connect annex')
  expect((await runtime.dispatch(archive)).output).toEqual([
    { kind: 'error', text: expect.stringContaining('Permission denied') },
  ])
  expect((await runtime.dispatch(card)).output).toEqual([
    { kind: 'error', text: expect.stringContaining('Permission denied') },
  ])
  await runtime.dispatch(login('🧪'))
  expect((await runtime.dispatch(card)).output?.[0].kind).toBe('file')
  expect((await runtime.dispatch(archive)).output).toMatchObject([
    { kind: 'mail', path: '/exhibit/sealed', messages: [{ subject: 'Sealed correspondence' }] },
  ])
  expect(runtime.state.completed).toBe(false)
  await runtime.dispatch(annex)
  await runtime.dispatch({ type: 'cat', path: '/document' })
  expect(runtime.state.completed).toBe(true)
})

it('serializes authentication and discards work invalidated by a reset', async () => {
  const scenario = await relay()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const runtime = createRuntime(scenario, {
    ...engine,
    evaluate: async (...args) => {
      await gate
      return engine.evaluate(...args)
    },
  })
  await runtime.dispatch(connect)
  const pending = runtime.dispatch(login(compatible))
  expect((await runtime.dispatch(login(compatible))).output?.[0].kind).toBe('error')
  expect((await runtime.dispatch(incident)).output?.[0].kind).toBe('error')
  await runtime.dispatch({ type: 'reset' })
  release()
  expect(await pending).toEqual({})
  expect(runtime.state.host).toBeUndefined()
})

it('returns WASM normalization output and guards payload transfers in the dispatcher', async () => {
  const runtime = createRuntime(await relay(), engine)
  const before = runtime.state
  expect(await runtime.dispatch({ type: 'inspect', character: 'U+00E9' })).toEqual({
    output: [
      {
        kind: 'inspection',
        point: expect.objectContaining({ scalar: 'é', notation: 'U+00E9' }),
        category: 'Lowercase letter',
        details: {
          ok: true,
          value: expect.objectContaining({
            name: 'LATIN SMALL LETTER E WITH ACUTE',
            script: 'Latin',
          }),
        },
        normalization: ['NFC', 'NFD', 'NFKC', 'NFKD'].map((form, index) => ({
          form,
          result: { ok: true, value: index % 2 ? 'e\u0301' : 'é' },
        })),
      },
    ],
  })
  expect(runtime.state).toBe(before)
  const insertion = { type: 'editPayload', mode: 'insert', text: 'e\u0301' } as const
  expect(await runtime.dispatch(insertion)).toEqual({ transfer: insertion })
  await runtime.dispatch(connect)
  await runtime.dispatch({ type: 'login' })
  expect(await runtime.dispatch(insertion)).toEqual({ transfer: insertion })
  expect((await runtime.dispatch({ type: 'copy', text: '\ud800' })).output?.[0].kind).toBe('error')
})

it.each([
  ['  help  ', { type: 'help' }],
  ['hosts', { type: 'hosts' }],
  ['connect relay-07', connect],
  ['ls', { type: 'ls', path: undefined }],
  ["cat '/exhibit/sample card'", { type: 'cat', path: '/exhibit/sample card' }],
  ['whoami', { type: 'whoami' }],
  ['login', { type: 'login', alias: undefined }],
  ['login ""', login('')],
  ['login "  Ｍ🧪e\u0301  "', login('  Ｍ🧪e\u0301  ')],
  [String.raw`login "a\"b\\c"`, login('a"b\\c')],
  ['logout', { type: 'logout' }],
  ['inspect Ｍ', { type: 'inspect', character: 'Ｍ' }],
  ['clear', { type: 'clear' }],
  ['cat', { type: 'invalid', message: 'Usage: cat <path>' }],
  ['cat "file', { type: 'invalid', message: 'Close the quoted argument.' }],
  ['ls | cat file', { type: 'invalid', message: 'Usage: ls [path]' }],
])('parses %s', (raw, action) => {
  expect(parseCommand(raw as string)).toEqual(action)
})

it('preserves aliases in generated commands and rejects unknown commands', () => {
  const action = login(' Ｍ"e\u0301\\ 🧪 ')
  expect(parseCommand(actionCommand(action)!)).toEqual(action)
  expect(parseCommand('echo nope')).toMatchObject({
    type: 'invalid',
    message: expect.stringContaining('Unknown command'),
  })
  expect(parseCommand('   ')).toBeUndefined()
})
