import type { Action } from './runtime.ts'
import { puzzleArity, type PuzzleCommand } from './scenario.ts'
import { decodeUnicodeEscapes, readUnicodeEscape, scalarSpan, type Span } from './unicode.ts'

export type ArgumentKind = 'text' | 'path' | 'host' | 'message' | 'scenario' | 'scalar' | 'payload'
export interface CommandArgument {
  name: string
  label: string
  kind: ArgumentKind
  required: boolean
  initial: string
}
const argument = (name: string, kind: ArgumentKind, required = true): CommandArgument => ({
  name,
  label: name,
  kind,
  required,
  initial: '',
})

// Parsing, help, completion and the composer share this vocabulary. Scenario bindings
// supply puzzle field labels, defaults and fixed context, never another input UI.
export const commandRegistry = [
  { name: 'help', usage: 'help', description: 'Show this command reference.', arguments: [] },
  { name: 'hosts', usage: 'hosts', description: 'List known hosts.', arguments: [] },
  {
    name: 'mail',
    usage: 'mail [message]',
    description: 'List local mail or read a message.',
    arguments: [argument('message', 'message', false)],
  },
  {
    name: 'connect',
    usage: 'connect <host>',
    description: 'Start a guest session on a host.',
    arguments: [argument('host', 'host')],
  },
  {
    name: 'ls',
    usage: 'ls [path]',
    description: 'List a directory. Paths are relative to /.',
    arguments: [argument('path', 'path', false)],
  },
  {
    name: 'cat',
    usage: 'cat <path>',
    description: 'Read a file.',
    arguments: [argument('path', 'path')],
  },
  { name: 'whoami', usage: 'whoami', description: 'Show the current identity.', arguments: [] },
  {
    name: 'login',
    usage: 'login [alias]',
    description: 'Compose or submit an alias.',
    arguments: [argument('alias', 'payload')],
  },
  {
    name: 'route',
    usage: 'route [header envelope]',
    description: 'Compose or submit both recipients.',
    arguments: [argument('header', 'payload'), argument('envelope', 'payload')],
  },
  {
    name: 'reconcile',
    usage: 'reconcile [candidate]',
    description: 'Query an identifier collision.',
    arguments: [argument('candidate', 'payload')],
  },
  {
    name: 'reconstruct',
    usage: 'reconstruct [name-a name-b]',
    description: 'Verify both original record names.',
    arguments: [argument('name-a', 'payload'), argument('name-b', 'payload')],
  },
  {
    name: 'campaign',
    usage: 'campaign',
    description: 'List discovered destinations.',
    arguments: [],
  },
  {
    name: 'scenario',
    usage: 'scenario <id>',
    description: 'Enter a discovered scenario.',
    arguments: [argument('id', 'scenario')],
  },
  { name: 'logout', usage: 'logout', description: 'Return to guest access.', arguments: [] },
  {
    name: 'inspect',
    usage: 'inspect <character>',
    description: 'Show Unicode details for a scalar or code point.',
    arguments: [argument('character', 'scalar')],
  },
  { name: 'clear', usage: 'clear', description: 'Clear terminal scrollback.', arguments: [] },
] as const
export type CommandName = (typeof commandRegistry)[number]['name']
export const commandHelp = commandRegistry.map(
  ({ usage, description }) => [usage, description] as const,
)
export function commandDefinition(name: string) {
  return commandRegistry.find((command) => command.name === name)
}
export function composerArguments(
  name: CommandName,
  operations: readonly import('./scenario.ts').PuzzleBinding[],
): CommandArgument[] {
  const definition = commandDefinition(name)!
  const binding = operations.find((operation) => operation.command === name)
  return binding
    ? binding.fields
        .filter((field) => field.fixed === undefined)
        .map((field) => ({
          name: field.input,
          label: field.label,
          initial: field.initial,
          required: true,
          kind: 'payload',
        }))
    : [...definition.arguments]
}
export function spaceCommand(source: string, composing = false): CommandName | undefined {
  if (composing) return
  const match = /^([a-z]+) $/u.exec(source)
  return match ? commandDefinition(match[1])?.name : undefined
}

function tokenize(source: string, draft = false) {
  const args: string[] = []
  let token = ''
  let quote = ''
  let started = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    const next = source[index + 1]
    const escape = char === '\\' ? readUnicodeEscape(source, index) : undefined
    if (escape) {
      if ('error' in escape && !draft) return { args, quote, error: escape.error }
      token += draft ? source.slice(index, escape.end) : 'text' in escape ? escape.text : ''
      started = true
      index = escape.end - 1
    } else if (
      char === '\\' &&
      (next === '\\' || next === (quote || '"') || (!quote && next === "'"))
    ) {
      token += draft && next === '\\' ? '\\u00005C' : next
      started = true
      index++
    } else if (quote) {
      if (char === quote) quote = ''
      else token += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/[ \t\r\n]/u.test(char)) {
      if (started) args.push(token)
      token = ''
      started = false
    } else {
      token += char
      started = true
    }
  }
  if (started) args.push(token)
  return { args, quote, started }
}

export function commandDraft(source: string) {
  const parsed = tokenize(source, true)
  const definition = commandDefinition(parsed.args[0])
  if (!definition || parsed.quote || parsed.error) return
  return { name: definition.name, values: parsed.args.slice(1) }
}

// Map a one-line native selection into the parameter draft without treating decoded
// whitespace or quote escapes as command syntax. Structured retries use raw UTF-16.
export function commandDraftSelection(source: string, selection: Span) {
  const draft = commandDraft(source)
  if (!draft?.values.length) return
  const position = (offset: number) => {
    const prefix = tokenize(source.slice(0, offset), true)
    const index = Math.min(
      draft.values.length - 1,
      Math.max(0, prefix.args.length - (prefix.started ? 2 : 1)),
    )
    const local = prefix.started && prefix.args.length > 1 ? prefix.args.at(-1)!.length : 0
    return { index, offset: Math.min(local, draft.values[index].length) }
  }
  const start = position(selection.start)
  const end = position(selection.end)
  const span = scalarSpan(draft.values[start.index], {
    start: start.offset,
    end: end.index === start.index ? end.offset : draft.values[start.index].length,
  })
  return { index: start.index, span }
}

export function parseCommand(source: string): Action | undefined {
  const { args, quote, error } = tokenize(source)
  if (error) return { type: 'invalid', message: error }
  if (quote) return { type: 'invalid', message: 'Close the quoted argument.' }
  if (!args.length) return
  const [command] = args
  const definition = commandDefinition(command)
  if (!definition)
    return { type: 'invalid', message: `Unknown command "${command}". Type help for commands.` }
  const count = args.length - 1
  const minimum =
    Object.hasOwn(puzzleArity, command) && !count
      ? 0
      : definition.arguments.filter((field) => field.required).length
  if (count < minimum || count > definition.arguments.length)
    return { type: 'invalid', message: `Usage: ${definition.usage}` }

  return commandAction(command as CommandName, args.slice(1))
}

export function composerAction(
  name: CommandName,
  values: string[],
  operations: readonly import('./scenario.ts').PuzzleBinding[],
): Action {
  const fields = composerArguments(name, operations)
  const decoded: string[] = []
  for (const [index, field] of fields.entries()) {
    const result = decodeUnicodeEscapes(values[index] ?? field.initial)
    if ('error' in result) return { type: 'invalid', message: field.label + ' · ' + result.error }
    if (result.text !== '' || field.required) decoded.push(result.text)
  }
  return commandAction(name, decoded)
}

export function commandAction(command: CommandName, values: string[] = []): Action {
  if (Object.hasOwn(puzzleArity, command))
    return puzzleAction(command as PuzzleCommand, values.length ? values : undefined)
  const argument = values[0]
  switch (command) {
    case 'connect':
      return { type: 'connect', host: argument }
    case 'ls':
      return { type: 'ls', path: argument }
    case 'cat':
      return { type: 'cat', path: argument }
    case 'mail':
      return { type: 'mail', id: argument }
    case 'scenario':
      return { type: 'scenario', id: argument }
    case 'campaign':
      return { type: 'campaign' }
    case 'inspect':
      return { type: 'inspect', character: argument }
    case 'hosts':
    case 'help':
    case 'whoami':
    case 'logout':
    case 'clear':
      return { type: command }
    default:
      throw new Error('Unsupported command: ' + command)
  }
}

export function puzzleAction(command: PuzzleCommand, values?: string[]): Action {
  switch (command) {
    case 'login':
      return { type: command, alias: values?.[0] }
    case 'reconcile':
      return { type: command, payload: values?.[0] }
    default:
      return { type: command, payloads: values }
  }
}

export function matchSuggestions(source: string, candidates: string[]): string[] {
  const query = source.trimStart()
  if (!query) return []
  const fileQuery = /^(cat|ls)[ \t]+(.*)$/u.exec(query)
  if (!fileQuery) return candidates.filter((item) => item.startsWith(query) && item !== query)

  const [, verb, input] = fileQuery
  const { args, quote: openQuote, error } = tokenize(input)
  if (error) return []
  const prefix = args[0] ?? ''
  if (args.length > 1 || (prefix && !openQuote && /[ \t]$/u.test(input))) return []

  return candidates.flatMap((item) => {
    if (!item.startsWith(verb + ' ')) return []
    const action = parseCommand(item)
    if ((action?.type !== 'cat' && action?.type !== 'ls') || !action.path) return []
    const path = prefix.startsWith('./')
      ? '.' + action.path
      : prefix.startsWith('/')
        ? action.path
        : action.path.slice(1)
    if (!path.startsWith(prefix) || (path === prefix && !openQuote)) return []
    return [`${verb} ${quote(path)}`]
  })
}

function quote(argument: string): string {
  // Native single-line controls project CR/LF away. Command serialization keeps
  // those scalars as explicit escapes, including when editing a command name.
  const escaped = argument.replace(/[\\"]/gu, '\\$&').replace(/[\p{Cc}]/gu, scalarEscape)
  return /[\s"'\\]/u.test(argument) || !argument ? '"' + escaped + '"' : escaped
}
function scalarEscape(scalar: string) {
  return '\\u' + scalar.codePointAt(0)!.toString(16).toUpperCase().padStart(6, '0')
}

export function commandInsertion(text: string): string {
  return text.replace(/["'\\\p{White_Space}\p{Cc}]/gu, scalarEscape)
}

export function actionCommand(action: Action): string | undefined {
  switch (action.type) {
    case 'connect':
      return `connect ${quote(action.host)}`
    case 'ls':
      return action.path === undefined ? 'ls' : `ls ${quote(action.path)}`
    case 'cat':
      return `cat ${quote(action.path)}`
    case 'mail':
      return action.id === undefined ? 'mail' : `mail ${quote(action.id)}`
    case 'login':
      return action.alias === undefined ? 'login' : `login ${quote(action.alias)}`
    case 'route':
    case 'reconstruct':
      return [action.type, ...(action.payloads?.map(quote) ?? [])].join(' ')
    case 'reconcile':
      return action.payload === undefined ? action.type : `${action.type} ${quote(action.payload)}`
    case 'scenario':
      return `scenario ${quote(action.id)}`
    case 'inspect':
      return action.character === undefined ? undefined : `inspect ${quote(action.character)}`
    case 'invalid':
    case 'reset':
    case 'resetCampaign':
    case 'copy':
    case 'insertCommand':
    case 'editPayload':
      return
    default:
      return action.type
  }
}
