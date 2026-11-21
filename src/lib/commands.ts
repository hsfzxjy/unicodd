import type { Action, ConsoleAction } from './runtime.ts'
import { recoveryArity, type RecoveryCommand } from './recovery.ts'
import { dossierArity, type DossierCommand } from './dossier.ts'
import { puzzleArity, type OperationBinding, type OperationCommand } from './scenario.ts'
import type { ArgumentInspector } from './argument-inspectors.ts'
import {
  decodeUnicodeEscapes,
  projectCommandText,
  readCommandEscape,
  scalarSpan,
  type Span,
} from './unicode.ts'

export type ArgumentKind =
  'text' | 'path' | 'host' | 'message' | 'scenario' | 'scalar' | 'payload' | 'json'
export interface CommandArgument {
  name: string
  label: string
  kind: ArgumentKind
  required: boolean
  initial: string
  inspectors?: readonly ArgumentInspector[]
}
const argument = (name: string, kind: ArgumentKind, required = true): CommandArgument => ({
  name,
  label: name,
  kind,
  required,
  initial: '',
})
export const operationArity = { ...puzzleArity, ...recoveryArity, ...dossierArity }
const consoleCommands = ['hosts', 'mail', 'connect', 'campaign', 'scenario'] as const
type ConsoleCommand = (typeof consoleCommands)[number]
export const isConsoleCommand = (name: string): name is ConsoleCommand =>
  consoleCommands.some((command) => command === name)
const localCommands = ['help', ...consoleCommands] as const
export function scopedConsoleCommand(name: string) {
  return localCommands.find((command) => name === `local ${command}`)
}

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
const baseCommands = [
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
    description: 'Connect to a listed host from the local console.',
    arguments: [argument('host', 'host')],
  },
  {
    name: 'ls',
    usage: 'ls [path]',
    description: 'List a directory on the connected host.',
    arguments: [argument('path', 'path', false)],
  },
  {
    name: 'cat',
    usage: 'cat <path>',
    description: 'Read a file or archived mail thread.',
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
    'Verify archive references across both readers.',
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
    'Translate a source range between offset spaces.',
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
    description: 'List the cases you can open.',
    arguments: [],
  },
  {
    name: 'scenario',
    usage: 'scenario <id>',
    description: 'Open an available case.',
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
    arguments: [{ ...argument('character', 'scalar'), inspectors: ['code-points'] }],
  },
  { name: 'clear', usage: 'clear', description: 'Clear terminal scrollback.', arguments: [] },
] as const
export const commandRegistry = [
  ...baseCommands,
  ...localCommands.map((name) => {
    const definition = baseCommands.find((command) => command.name === name)!
    return {
      ...definition,
      name: `local ${name}` as const,
      usage: `local ${definition.usage}`,
      description:
        name === 'help' ? 'Show commands for the local console.' : definition.description,
    }
  }),
]
export type CommandName = (typeof commandRegistry)[number]['name']
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
          inspectors: field.inspectors,
        }))
    : [...definition.arguments]
}
export function spaceCommand(source: string, composing = false): CommandName | undefined {
  if (composing) return
  const match = /^((?:local )?[a-z-]+) $/u.exec(source)
  return match ? commandDefinition(match[1])?.name : undefined
}

function decodedWord(word = '') {
  if (!word.includes('\\')) return word
  const decoded = decodeUnicodeEscapes(word)
  return 'text' in decoded ? decoded.text : word
}

function tokenize(source: string) {
  const args: string[] = []
  let token = ''
  let quote = ''
  let started = false
  let definition: ReturnType<typeof commandDefinition>
  let rendered = ''
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    const next = source[index + 1]
    const json = definition?.arguments[args.length - 1]?.kind === 'json'
    const escape = char === '\\' && !json ? readCommandEscape(source, index) : undefined
    if (escape) {
      const raw = source.slice(index, escape.end)
      token += raw
      rendered += escape.text ?? raw
      started = true
      index = escape.end - 1
      continue
    }
    // Uppercase U is outside the JSON escape grammar. The double-quoted shell form
    // uses these two spellings to carry line breaks through the native one-line prompt.
    const lineBreak = json && quote === '"' && char === '\\' && readJsonLineBreak(source, index)
    if (lineBreak) {
      token += lineBreak
      rendered += lineBreak
      index += 7
      continue
    }
    const escapedQuote = next === (quote || '"') || (!quote && next === "'")
    const escapedJsonBackslash = json && quote !== "'" && next === '\\'
    if (char === '\\' && (escapedQuote || escapedJsonBackslash)) {
      token += next
      rendered += next
      started = true
      index++
      continue
    }
    rendered += char
    if (quote) {
      if (char === quote) quote = ''
      else token += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/[ \t\r\n]/u.test(char)) {
      if (started) {
        args.push(token)
        if (args.length === 1) definition = commandDefinition(decodedWord(token))
      }
      token = ''
      started = false
    } else {
      token += char
      started = true
    }
  }
  if (started) args.push(token)
  return { args, quote, started, rendered }
}

export function commandEcho(source: string) {
  return tokenize(source).rendered
}

export function commandDraft(source: string) {
  const parsed = tokenize(source)
  const [command, subcommand] = parsed.args.slice(0, 2).map(decodedWord)
  const scoped = command === 'local'
  const definition = commandDefinition(scoped ? `local ${subcommand}` : command)
  if (!definition || parsed.quote) return
  return { name: definition.name, values: parsed.args.slice(scoped ? 2 : 1) }
}

// Map a one-line native selection into the parameter draft without treating decoded
// whitespace or quote escapes as command syntax. Structured retries use raw UTF-16.
export function commandDraftSelection(source: string, selection: Span) {
  const draft = commandDraft(source)
  if (!draft?.values.length) return
  const commandWords = draft.name.startsWith('local ') ? 2 : 1
  const position = (offset: number) => {
    const prefix = tokenize(source.slice(0, offset))
    const index = Math.min(
      draft.values.length - 1,
      Math.max(0, prefix.args.length - commandWords - Number(prefix.started)),
    )
    const local =
      prefix.started && prefix.args.length > commandWords ? prefix.args.at(-1)!.length : 0
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
  const { args, quote } = tokenize(source)
  if (quote) return { type: 'invalid', message: 'Close the quoted argument.' }
  if (!args.length) return
  const [command, subcommand] = args.slice(0, 2).map(decodedWord)
  const scoped = command === 'local'
  const definition = commandDefinition(scoped ? `local ${subcommand}` : command)
  if (!definition && scoped)
    return { type: 'invalid', message: `Local console commands: ${localCommands.join(', ')}.` }
  if (!definition)
    return { type: 'invalid', message: `Unknown command "${command}". Type help for commands.` }
  const values = args.slice(scoped ? 2 : 1)
  const count = values.length
  const minimum =
    Object.hasOwn(operationArity, command) && !count
      ? 0
      : definition.arguments.filter((field) => field.required).length
  if (count < minimum || count > definition.arguments.length)
    return { type: 'invalid', message: `Usage: ${definition.usage}` }

  return decodedAction(definition.name, values, definition.arguments, false)
}

export function composerAction(
  name: CommandName,
  values: string[],
  operations: readonly OperationBinding[],
): Action {
  const fields = composerArguments(name, operations)
  return decodedAction(
    name,
    fields.map((field, index) => values[index] ?? field.initial),
    fields,
    true,
  )
}

function decodedAction(
  name: CommandName,
  values: string[],
  fields: readonly CommandArgument[],
  structured: boolean,
): Action {
  const decoded: string[] = []
  for (const [index, value] of values.entries()) {
    const field = fields[index]
    const result = field.kind === 'json' ? { text: value } : decodeUnicodeEscapes(value)
    if ('error' in result)
      return {
        type: 'invalid',
        message: structured ? field.label + ' · ' + result.error : result.error,
      }
    if (!structured || result.text !== '' || field.required) decoded.push(result.text)
  }
  return commandAction(name, decoded)
}

export function commandAction(command: CommandName, values: string[] = []): Action {
  if (Object.hasOwn(operationArity, command))
    return puzzleAction(command as OperationCommand, values.length ? values : undefined)
  const argument = values[0]
  const local = scopedConsoleCommand(command)
  if (local) return { ...consoleAction(local, argument), scope: 'local' }
  if (isConsoleCommand(command)) return consoleAction(command, argument)
  switch (command) {
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

function consoleAction(command: (typeof localCommands)[number], argument: string): ConsoleAction {
  switch (command) {
    case 'connect':
      return { type: 'connect', host: argument }
    case 'mail':
      return { type: 'mail', id: argument }
    case 'scenario':
      return { type: 'scenario', id: argument }
    case 'hosts':
    case 'campaign':
    case 'help':
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
  const { args, quote: openQuote } = tokenize(input)
  const prefixResult = decodeUnicodeEscapes(args[0] ?? '')
  if ('error' in prefixResult) return []
  const prefix = prefixResult.text
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

function quoteDraft(source: string) {
  let escaped = ''
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    const existing = char === '\\' ? readCommandEscape(source, index) : undefined
    if (existing) {
      escaped += source.slice(index, existing.end)
      index = existing.end - 1
    } else if (char === '\\' || char === '"') escaped += '\\' + char
    else escaped += /\p{Cc}/u.test(char) ? scalarEscape(char) : char
  }
  const hasWhitespace = /\s/u.test(projectCommandText(source).text)
  return !source || hasWhitespace || source.includes("'") ? '"' + escaped + '"' : escaped
}

const jsonLineBreaks = { '\r': '\\U00000D', '\n': '\\U00000A' } as const

function readJsonLineBreak(source: string, offset: number) {
  if (source.startsWith(jsonLineBreaks['\r'], offset)) return '\r'
  if (source.startsWith(jsonLineBreaks['\n'], offset)) return '\n'
}

function quoteJson(value: string) {
  const escaped = value
    .replace(/[\\"]/gu, '\\$&')
    .replace(/[\r\n]/gu, (char) => jsonLineBreaks[char as keyof typeof jsonLineBreaks])
  return '"' + escaped + '"'
}

export function composerCommand(
  name: CommandName,
  values: string[],
  fields: readonly CommandArgument[],
) {
  return [
    name,
    ...fields.flatMap((field, index) => {
      const value = values[index] ?? field.initial
      if (!field.required && !value) return []
      return [field.kind === 'json' ? quoteJson(value) : quoteDraft(value)]
    }),
  ].join(' ')
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
      return [action.type, ...(action.payloads?.map(quoteJson) ?? [])].join(' ')
    case 'reconcile':
      return action.payload === undefined ? action.type : `${action.type} ${quote(action.payload)}`
    case 'scenario':
      return `${prefix}scenario ${quote(action.id)}`
    case 'hosts':
    case 'campaign':
    case 'help':
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
