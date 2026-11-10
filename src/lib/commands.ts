import type { Action } from './runtime.ts'
import { readUnicodeEscape } from './unicode.ts'

export const commandHelp = [
  ['help', 'Show this command reference.'],
  ['hosts', 'List known hosts.'],
  ['mail [message]', 'List local mail or read a message by ID.'],
  ['connect <host>', 'Start a guest session on a host.'],
  ['ls [path]', 'List a directory. Paths are relative to /.'],
  ['cat <path>', 'Read a file.'],
  ['whoami', 'Show the current identity.'],
  ['login [alias]', 'Open the alias editor or submit an alias.'],
  ['logout', 'Return to guest access.'],
  ['inspect <character>', 'Show Unicode details for a scalar or code point.'],
  ['clear', 'Clear terminal scrollback.'],
] as const

function tokenize(source: string) {
  const args: string[] = []
  let token = ''
  let quote = ''
  let started = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    const next = source[index + 1]
    const escape = char === '\\' ? readUnicodeEscape(source, index) : undefined
    if (escape) {
      if ('error' in escape) return { args, quote, error: escape.error }
      token += escape.text
      started = true
      index = escape.end - 1
    } else if (
      char === '\\' &&
      (next === '\\' || next === (quote || '"') || (!quote && next === "'"))
    ) {
      token += next
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
  return { args, quote }
}

export function parseCommand(source: string): Action | undefined {
  const { args, quote, error } = tokenize(source)
  if (error) return { type: 'invalid', message: error }
  if (quote) return { type: 'invalid', message: 'Close the quoted argument.' }
  if (!args.length) return
  const [command, argument] = args
  const help = commandHelp.find(([usage]) => usage.split(' ')[0] === command)
  if (!help)
    return { type: 'invalid', message: `Unknown command "${command}". Type help for commands.` }
  const minimum = help[0].includes('<') ? 2 : 1
  const maximum = help[0].includes(' ') ? 2 : 1
  if (args.length < minimum || args.length > maximum)
    return { type: 'invalid', message: `Usage: ${help[0]}` }
  switch (command) {
    case 'connect':
      return { type: 'connect', host: argument }
    case 'ls':
      return { type: 'ls', path: argument }
    case 'cat':
      return { type: 'cat', path: argument }
    case 'mail':
      return { type: 'mail', id: argument }
    case 'login':
      return { type: 'login', alias: argument }
    case 'inspect':
      return { type: 'inspect', character: argument }
    case 'hosts':
    case 'help':
    case 'whoami':
    case 'logout':
    case 'clear':
      return { type: command }
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
  return /[\s"'\\]/u.test(argument) || !argument
    ? '"' + argument.replace(/[\\"]/g, '\\$&') + '"'
    : argument
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
    case 'inspect':
      return action.character === undefined ? undefined : `inspect ${quote(action.character)}`
    case 'invalid':
    case 'reset':
    case 'closeEditor':
    case 'copy':
    case 'editPayload':
      return
    default:
      return action.type
  }
}
