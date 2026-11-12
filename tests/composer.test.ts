import { describe, expect, it } from 'vitest'
import {
  actionCommand,
  commandDraft,
  commandDraftSelection,
  commandRegistry,
  composerAction,
  composerArguments,
  parseCommand,
  spaceCommand,
} from '../src/lib/commands'
import { decodeUnicodeEscapes } from '../src/lib/unicode'
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
    for (const text of ['lo ', 'unknown ', ' Login ', 'login  '])
      expect(spaceCommand(text)).toBeUndefined()
  })
  it('uses the same actions for every typed and structured command', () => {
    for (const command of commandRegistry) {
      const values =
        command.name === 'local'
          ? ['mail', 'a🧪é\u200b 1']
          : command.arguments.map((_, index) => 'a🧪é\u200b ' + index)
      const action = composerAction(command.name, values, [])
      expect(parseCommand(actionCommand(action)!)).toEqual(action)
    }
    expect(composerAction('ls', [''], [])).toEqual(parseCommand('ls'))
    expect(composerAction('mail', [''], [])).toEqual(parseCommand('mail'))
    expect(parseCommand('local mail')).toEqual({ type: 'mail', scope: 'local', id: undefined })
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
  it('derives all editable fields from validated bindings and excludes fixed context', async () => {
    for (const entry of await production.manifest()) {
      const scenario = await production.scenario(entry)
      for (const host of scenario.hosts)
        for (const binding of host.operations) {
          const fields = composerArguments(binding.command, host.operations)
          expect(fields.map((field) => [field.name, field.label, field.initial])).toEqual(
            binding.fields
              .filter((field) => field.fixed === undefined)
              .map((field) => [field.input, field.label, field.initial]),
          )
          expect(fields.length).toBe(
            commandRegistry.find((command) => command.name === binding.command)!.arguments.length,
          )
          expect(fields.every((field) => field.kind === 'payload')).toBe(true)
        }
    }
    expect(decodeUnicodeEscapes(String.raw`\u01F9EA`)).toEqual({ text: '🧪' })
  })
})
