import type { Action } from './runtime.ts'

export const commandHelp = [
  ['help', 'Show this command reference.'],
  ['hosts', 'List known hosts.'],
  ['connect <host>', 'Start a guest session on a host.'],
  ['ls [path]', 'List a directory. Paths are relative to /.'],
  ['cat <path>', 'Read a file.'],
  ['whoami', 'Show the current identity.'],
  ['login [alias]', 'Open the alias editor or submit an alias.'],
  ['logout', 'Return to guest access.'],
  ['inspect <character>', 'Open the Workbench for a scalar or code point.'],
  ['clear', 'Clear terminal scrollback.'],
] as const

export function parseCommand(source: string): Action | undefined {
  const args: string[] = []
  let token = ''
  let quote = ''
  let started = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    const next = source[index + 1]
    if (char === '\\' && (next === '\\' || next === (quote || '"') || (!quote && next === "'"))) {
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
  if (quote) return { type: 'invalid', message: 'Close the quoted argument.' }
  if (started) args.push(token)
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
    case 'login':
      return action.alias === undefined ? 'login' : `login ${quote(action.alias)}`
    case 'inspect':
      return `inspect ${quote(action.character)}`
    case 'invalid':
    case 'reset':
    case 'closeEditor':
      return
    default:
      return action.type
  }
}
