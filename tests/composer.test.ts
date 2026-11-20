import { describe, expect, it } from 'vitest'
import {
  actionCommand,
  commandDraft,
  commandDraftSelection,
  commandEcho,
  commandRegistry,
  composerAction,
  composerArguments,
  composerCommand,
  parseCommand,
  spaceCommand,
} from '../src/lib/commands'
import { decodeUnicodeEscapes } from '../src/lib/unicode'
import { restoreComposerDraft } from '../src/lib/workspace'
import { production } from './scenario-content'

describe('authoritative command metadata', () => {
  it('tags every exact command on Space, deferring partial, unknown and IME input', () => {
    expect(new Set(commandRegistry.map((command) => command.name)).size).toBe(
      commandRegistry.length,
    )
    for (const command of commandRegistry) {
      expect(spaceCommand(command.name + ' ')).toBe(command.name)
      expect(spaceCommand(command.name + ' ', true)).toBeUndefined()
      expect(spaceCommand(command.name)).toBeUndefined()
      expect(spaceCommand(command.name + ' argument')).toBeUndefined()
    }
    for (const text of ['lo ', 'local ', 'local ls ', 'unknown ', ' Login ', 'login  '])
      expect(spaceCommand(text)).toBeUndefined()
  })
  it('uses the same actions for every typed and structured command', () => {
    for (const command of commandRegistry) {
      const values = command.arguments.map((_, index) => 'a🧪é\u200b ' + index)
      const action = composerAction(command.name, values, [])
      expect(parseCommand(actionCommand(action)!)).toEqual(action)
    }
    expect(composerAction('ls', [''], [])).toEqual(parseCommand('ls'))
    expect(composerAction('mail', [''], [])).toEqual(parseCommand('mail'))
    expect(parseCommand('local mail')).toEqual({ type: 'mail', scope: 'local', id: undefined })
    expect(parseCommand('local help')).toEqual({ type: 'help', scope: 'local' })
    expect(parseCommand('local help extra')).toEqual({
      type: 'invalid',
      message: 'Usage: local help',
    })
    expect(parseCommand('local connect')).toEqual({
      type: 'invalid',
      message: 'Usage: local connect <host>',
    })
    expect(parseCommand('local ls /')).toMatchObject({ type: 'invalid' })
    expect(composerAction('route', ['  x y  ', 'a\r\nb\0🧪'], [])).toEqual({
      type: 'route',
      payloads: ['  x y  ', 'a\r\nb\0🧪'],
    })
  })
  it('uses scoped arguments in one-line drafts and retains previously saved local drafts', () => {
    const source = 'local\tconnect "a🧪b"'
    expect(commandDraft(source)).toEqual({ name: 'local connect', values: ['a🧪b'] })
    expect(commandDraftSelection(source, { start: 16, end: 18 })).toEqual({
      index: 0,
      span: { start: 1, end: 3 },
    })
    const legacy = {
      name: 'local' as const,
      text: '',
      values: ['connect', 'a🧪b'],
      active: 1,
      spans: [
        { start: 0, end: 0 },
        { start: 1, end: 3 },
      ],
    }
    expect(restoreComposerDraft(legacy)).toMatchObject({
      name: 'local connect',
      values: ['a🧪b'],
      active: 0,
      spans: [{ start: 1, end: 3 }],
    })
    expect(restoreComposerDraft({ ...legacy, values: ['con'] })).toMatchObject({
      text: 'local con',
    })
  })
  it('retains quoted Unicode and escape spellings for one-line retry and history', () => {
    const source = String.raw`route "Mi\u00200Bra" "\u00FF2Dira"`
    const draft = commandDraft(source)!
    expect(draft.values).toEqual([String.raw`Mi\u00200Bra`, String.raw`\u00FF2Dira`])
    expect(composerAction(draft.name, draft.values, [])).toEqual(parseCommand(source))
    for (const source of [
      String.raw`login \\u000041`,
      String.raw`login \u00005Cu000041`,
      String.raw`login "a\"b\\c"`,
    ]) {
      const draft = commandDraft(source)!
      expect(composerAction(draft.name, draft.values, [])).toEqual(parseCommand(source))
    }
    const invalid = commandDraft(String.raw`login \u00D800`)!
    expect(composerAction(invalid.name, invalid.values, [])).toMatchObject({ type: 'invalid' })
  })
  it('maps quoted native UTF-16 selections into the exact retry parameter', () => {
    const source = 'route "a🧪b" "é​"'
    expect(commandDraftSelection(source, { start: 8, end: 10 })).toEqual({
      index: 0,
      span: { start: 1, end: 3 },
    })
    expect(commandDraftSelection(source, { start: 14, end: 17 })).toEqual({
      index: 1,
      span: { start: 0, end: 3 },
    })
    expect(commandDraftSelection('help', { start: 0, end: 4 })).toBeUndefined()
    const action = { type: 'login', alias: 'a\r\nb\t\0' } as const
    expect(actionCommand(action)).not.toMatch(/[\r\n\t\0]/u)
    expect(parseCommand(actionCommand(action)!)).toEqual(action)
  })
  it('round-trips raw command escapes across editing, execution and echo', () => {
    const draft = [String.raw`x\UAEz \"q\" \\u0041`, String.raw`\uD83E\uDDEAE`]
    const fields = composerArguments('route', [])
    const source = composerCommand('route', draft, fields)
    expect(source).toBe(String.raw`route "x\UAEz \"q\" \\u0041" \uD83E\uDDEAE`)
    // A seventh hex digit begins the next literal character.
    const second = String.raw`\u00D83E\u00DDEAE`
    expect(commandDraft(source)?.values).toEqual(draft)
    expect(parseCommand(source)).toMatchObject({ type: 'invalid' })
    const complete = composerCommand('route', [draft[0], second], fields)
    expect(parseCommand(complete)).toEqual({
      type: 'route',
      payloads: ['x®z "q" \\u0041', '🧪E'],
    })
    expect(commandEcho(complete)).toBe('route "x®z "q" \\u0041" 🧪E')

    const json = '{\r\n' + String.raw`"text":"\uD800","slash":"\\","upper":"\u00AE"` + '\n}'
    const jsonSource = composerCommand('json-check', [json], composerArguments('json-check', []))
    expect(commandDraft(jsonSource)?.values).toEqual([json])
    expect(parseCommand(jsonSource)).toEqual({ type: 'json-check', payloads: [json] })
    expect(parseCommand(`json-check '${json}'`)).toEqual({ type: 'json-check', payloads: [json] })
    expect(jsonSource).not.toMatch(/[\r\n]/u)
    expect(commandEcho(jsonSource)).toBe(`json-check "${json}"`)
    expect(commandEcho(jsonSource)).toContain('\r\n')
  })
  it('derives all editable fields from validated bindings and excludes fixed context', async () => {
    for (const entry of await production.manifest()) {
      const scenario = await production.scenario(entry)
      for (const host of scenario.hosts) {
        const operations = [...host.operations, ...(host.recovery ?? [])]
        for (const binding of operations) {
          const fields = composerArguments(binding.command, operations)
          expect(
            fields.map((field) => [field.name, field.label, field.initial, field.inspectors]),
          ).toEqual(
            binding.fields
              .filter((field) => field.fixed === undefined)
              .map((field) => [field.input, field.label, field.initial, field.inspectors]),
          )
          expect(fields.length).toBe(
            commandRegistry.find((command) => command.name === binding.command)!.arguments.length,
          )
        }
      }
    }
    expect(decodeUnicodeEscapes(String.raw`\u01F9EA`)).toEqual({ text: '🧪' })
  })
})
