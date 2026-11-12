import type { Action, ConsoleAction } from './runtime.ts'
import { recoveryArity, type RecoveryCommand } from './recovery.ts'
import { dossierArity, type DossierCommand } from './dossier.ts'
import { puzzleArity, type OperationBinding, type OperationCommand } from './scenario.ts'
import { decodeUnicodeEscapes, readUnicodeEscape, scalarSpan, type Span } from './unicode.ts'

export type ArgumentKind =
  'text' | 'path' | 'host' | 'message' | 'scenario' | 'scalar' | 'payload' | 'json'
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
export const operationArity = { ...puzzleArity, ...recoveryArity, ...dossierArity }
export const consoleCommands = ['hosts', 'mail', 'connect', 'campaign', 'scenario'] as const
type ConsoleCommand = (typeof consoleCommands)[number]
export const isConsoleCommand = (name: string): name is ConsoleCommand =>
  consoleCommands.some((command) => command === name)

function recoveryCommand<T extends RecoveryCommand | DossierCommand>(
  name: T,
  description: string,
  ...fields: (string | CommandArgument)[]
) {
  const args = fields.map((field) => (typeof field === 'string' ? argument(field, 'text') : field))
  return {
    name,
    usage: [name, ...args.map(({ name }) => '<' + name + '>')].join(' '),
    description,
    arguments: args,
  }
}

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
    description: 'Open a guest session on a host from the local console.',
    arguments: [argument('host', 'host')],
  },
  {
    name: 'local',
    usage: 'local <command> [argument]',
    description:
      'Use the local console from a remote session. Supports hosts, mail, connect, campaign and scenario.',
    arguments: [argument('command', 'text'), argument('argument', 'text', false)],
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
    description: 'Attempt maintenance sign-in with an account alias.',
    arguments: [argument('alias', 'payload')],
  },
  {
    name: 'route',
    usage: 'route [header envelope]',
    description: 'Replay the header and envelope recipients on the active router.',
    arguments: [argument('header', 'payload'), argument('envelope', 'payload')],
  },
  {
    name: 'reconcile',
    usage: 'reconcile [candidate]',
    description: 'Query the shared index for a collision bucket.',
    arguments: [argument('candidate', 'payload')],
  },
  {
    name: 'reconstruct',
    usage: 'reconstruct [name-a name-b]',
    description: 'Verify submitted names against both original registrations.',
    arguments: [argument('name-a', 'payload'), argument('name-b', 'payload')],
  },
  recoveryCommand(
    'collate',
    'Compare two titles under a locale profile.',
    'locale',
    'strength',
    'left',
    'right',
  ),
  recoveryCommand(
    'replay',
    'Replay the queue and audit traversal.',
    'locale',
    'strength',
    'cursor-strategy',
    'page-size',
    'cursor',
  ),
  recoveryCommand('recover', 'Recover two appeals from a verified replay.', 'appeal-a', 'appeal-b'),
  recoveryCommand('casing', 'Compare original and mapped channel labels.', 'profile', 'label'),
  recoveryCommand('lookup', 'Look up a receipt by channel label.', 'profile', 'channel'),
  recoveryCommand('probe', 'Audit a routing key against all receipt channels.', 'routing-key'),
  recoveryCommand(
    'bind',
    'Bind retrieved receipts to their verified owners.',
    'routing-key',
    'receipt-a',
    'receipt-b',
  ),
  recoveryCommand('prepare', 'Prepare the identity split.', 'identity-key', 'originals'),
  recoveryCommand(
    'preview',
    'Run the audit preview samples.',
    'units',
    'limit',
    'bidi',
    'controls',
  ),
  recoveryCommand('verify', 'Verify the staged recovery plan.'),
  recoveryCommand('commit', 'Apply the verified recovery transaction.'),
  recoveryCommand(
    'resolve',
    'Trace a URL through the virtual gateway.',
    'profile',
    'receipt',
    'url',
  ),
  recoveryCommand(
    'dispatch',
    'Verify and dispatch both source receipts.',
    'profile',
    'first-url',
    'second-url',
  ),
  recoveryCommand('capture', 'Show a range of captured network bytes.', 'offset', 'count'),
  recoveryCommand(
    'deframe',
    'Replay the captured byte stream through a candidate decoder.',
    'framing',
    'decoder',
    'errors',
    'integrity',
    'chunks',
  ),
  recoveryCommand(
    'identifier',
    'Compare a label against pinned Unicode identifier data.',
    'version',
    'label',
  ),
  recoveryCommand(
    'mirror',
    'Reconcile archive records with both identifier indexes.',
    'label-storage',
    'handle-policy',
    'search-version',
  ),
  recoveryCommand(
    'search',
    'Search the catalog and stage its original occurrences.',
    'query',
    'profile',
    'scope',
  ),
  recoveryCommand(
    'tokens',
    'Inspect boundaries and comparison keys in a source field.',
    'record',
    'field',
    'profile',
  ),
  recoveryCommand('select', 'Reconcile the staged catalog search against the review ledger.'),
  recoveryCommand(
    'source',
    'Open a selected sealed record or inspect its spans.',
    'record',
    'view',
  ),
  recoveryCommand(
    'map-span',
    'Map a range between decoded body and raw JSON.',
    'record',
    'offset-space',
    'range',
  ),
  recoveryCommand(
    'json-check',
    'Check strict JSON interchange and examine decoded fields.',
    argument('sample-or-json', 'json'),
  ),
  recoveryCommand(
    'redact',
    'Build a candidate release projection.',
    'selector',
    'replacement',
    'exports',
  ),
  recoveryCommand('surfaces', 'Inspect an output from the candidate release.', 'surface'),
  recoveryCommand('audit', 'Verify the candidate publication across its output surfaces.'),
  recoveryCommand('targets', 'List the virtual extraction targets and comparison policies.'),
  recoveryCommand(
    'probe-path',
    'Trace a path through a target namespace.',
    'target',
    'transform',
    'path',
  ),
  recoveryCommand(
    'assets',
    'Read the approved public inventory or an individual asset.',
    'file-id',
  ),
  recoveryCommand(
    'extract',
    'Stage a virtual extraction and inspect its result.',
    'target',
    'mapping',
  ),
  recoveryCommand('roundtrip', 'Read back the staged public bundle on every target.'),
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
  {
    name: 'logout',
    usage: 'logout',
    description: 'Close the remote session and return to the local console.',
    arguments: [],
  },
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
  operations: readonly OperationBinding[],
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
          kind: field.kind ?? 'payload',
        }))
    : [...definition.arguments]
}
export function spaceCommand(source: string, composing = false): CommandName | undefined {
  if (composing) return
  const match = /^([a-z-]+) $/u.exec(source)
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
    const json = commandDefinition(args[0])?.arguments[args.length - 1]?.kind === 'json'
    const escape = char === '\\' && !json ? readUnicodeEscape(source, index) : undefined
    if (escape) {
      if ('error' in escape && !draft) return { args, quote, error: escape.error }
      token += draft ? source.slice(index, escape.end) : 'text' in escape ? escape.text : ''
      started = true
      index = escape.end - 1
    } else if (
      char === '\\' &&
      (next === '\\' || next === (quote || '"') || (!quote && next === "'"))
    ) {
      token += draft && !json && next === '\\' ? '\\u00005C' : next
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
    Object.hasOwn(operationArity, command) && !count
      ? 0
      : definition.arguments.filter((field) => field.required).length
  if (count < minimum || count > definition.arguments.length)
    return { type: 'invalid', message: `Usage: ${definition.usage}` }

  return commandAction(command as CommandName, args.slice(1))
}

export function composerAction(
  name: CommandName,
  values: string[],
  operations: readonly OperationBinding[],
): Action {
  const fields = composerArguments(name, operations)
  const decoded: string[] = []
  for (const [index, field] of fields.entries()) {
    const value = values[index] ?? field.initial
    const result = field.kind === 'json' ? { text: value } : decodeUnicodeEscapes(value)
    if ('error' in result) return { type: 'invalid', message: field.label + ' · ' + result.error }
    if (result.text !== '' || field.required) decoded.push(result.text)
  }
  return commandAction(name, decoded)
}

export function commandAction(command: CommandName, values: string[] = []): Action {
  if (Object.hasOwn(operationArity, command))
    return puzzleAction(command as OperationCommand, values.length ? values : undefined)
  const argument = values[0]
  if (isConsoleCommand(command)) return consoleAction(command, argument)
  switch (command) {
    case 'local': {
      if (!isConsoleCommand(argument))
        return {
          type: 'invalid',
          message: 'Local console commands: hosts, mail, connect, campaign, scenario.',
        }
      const { arguments: fields, usage } = commandDefinition(argument)!
      if (values.length - 1 > fields.length || (fields[0]?.required && values[1] === undefined))
        return { type: 'invalid', message: `Usage: local ${usage}` }
      return { ...consoleAction(argument, values[1]), scope: 'local' }
    }
    case 'ls':
      return { type: 'ls', path: argument }
    case 'cat':
      return { type: 'cat', path: argument }
    case 'inspect':
      return { type: 'inspect', character: argument }
    case 'help':
    case 'whoami':
    case 'logout':
    case 'clear':
      return { type: command }
    default:
      throw new Error('Unsupported command: ' + command)
  }
}

function consoleAction(command: ConsoleCommand, argument: string): ConsoleAction {
  switch (command) {
    case 'connect':
      return { type: 'connect', host: argument }
    case 'mail':
      return { type: 'mail', id: argument }
    case 'scenario':
      return { type: 'scenario', id: argument }
    case 'hosts':
    case 'campaign':
      return { type: command }
  }
}

export function puzzleAction(command: OperationCommand, values?: string[]): Action {
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

export function actionCommand(action: Action, includeScope = true): string | undefined {
  const prefix = includeScope && 'scope' in action && action.scope === 'local' ? 'local ' : ''
  switch (action.type) {
    case 'connect':
      return `${prefix}connect ${quote(action.host)}`
    case 'ls':
      return action.path === undefined ? 'ls' : `ls ${quote(action.path)}`
    case 'cat':
      return `cat ${quote(action.path)}`
    case 'mail':
      return prefix + (action.id === undefined ? 'mail' : `mail ${quote(action.id)}`)
    case 'login':
      return action.alias === undefined ? 'login' : `login ${quote(action.alias)}`
    case 'route':
    case 'reconstruct':
      return [action.type, ...(action.payloads?.map(quote) ?? [])].join(' ')
    case 'json-check':
      return [
        action.type,
        ...(action.payloads?.map((value) => '"' + value.replace(/[\\"]/gu, '\\$&') + '"') ?? []),
      ].join(' ')
    case 'reconcile':
      return action.payload === undefined ? action.type : `${action.type} ${quote(action.payload)}`
    case 'scenario':
      return `${prefix}scenario ${quote(action.id)}`
    case 'hosts':
    case 'campaign':
      return prefix + action.type
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
      return 'payloads' in action
        ? [action.type, ...(action.payloads?.map(quote) ?? [])].join(' ')
        : action.type
  }
}
