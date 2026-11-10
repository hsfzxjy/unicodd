import { forms, type Engine, type Normalization, type Result } from '../types.ts'
import { actionCommand, commandHelp } from './commands.ts'
import {
  parentPath,
  type Effect,
  type Guard,
  type Host,
  type Identity,
  type Resource,
  type Scenario,
} from './scenario.ts'
import { describe, lookup, scalarCategory, unpairedSurrogate, type Point } from './unicode.ts'

export type Action =
  | { type: 'hosts' | 'whoami' | 'logout' | 'help' | 'clear' | 'reset' | 'closeEditor' }
  | { type: 'connect'; host: string }
  | { type: 'ls'; path?: string }
  | { type: 'cat'; path: string }
  | { type: 'login'; alias?: string }
  | { type: 'inspect'; character?: string }
  | { type: 'copy'; text: string }
  | { type: 'editPayload'; mode: 'insert' | 'replace'; text: string }
  | { type: 'invalid'; message: string }

export interface Link {
  label: string
  detail?: string
  action: Action
}

export interface Inspection {
  kind: 'inspection'
  point: Point
  category?: string
  normalization: { form: Normalization; result: Result<string> }[]
}

export type Output =
  | { kind: 'message' | 'error' | 'auth' | 'objective'; text: string }
  | { kind: 'listing'; path?: string; links: Link[] }
  | { kind: 'file'; path: string; text: string; inspectLines: number[] }
  | { kind: 'help'; connected: boolean }
  | Inspection

export interface Session {
  host?: Host
  identity: Identity
  flags: readonly string[]
  completed: boolean
  editing: boolean
}

export interface Response {
  output?: Output[]
  clear?: boolean
  inspectPrompt?: boolean
  transfer?: Extract<Action, { type: 'copy' | 'editPayload' }>
  edit?: boolean
}

export function createRuntime(scenario: Scenario, engine: Engine, completed = false) {
  const start = (completed: boolean): Session => {
    const host = scenario.hosts.find(({ id }) => id === scenario.initialHost)
    return { host, identity: host?.guest ?? scenario.local, flags: [], completed, editing: false }
  }
  let state = start(completed)
  let pending: Session | undefined

  const message = (text: string): Output => ({ kind: 'message', text })
  const error = (text: string): Response => ({ output: [{ kind: 'error', text }] })
  const welcome = () => [
    message(scenario.introduction),
    ...(state.host ? [message(state.host.welcome)] : [hosts()]),
  ]

  function allows(guard?: Guard): boolean {
    return (
      (!guard?.roles || guard.roles.includes(state.identity.role)) &&
      (!guard?.flag || state.flags.includes(guard.flag))
    )
  }

  function hostLinks(): Link[] {
    return scenario.hosts
      .filter(({ discover }) => !discover || state.flags.includes(discover))
      .map(({ id, name }) => ({ label: id, detail: name, action: { type: 'connect', host: id } }))
  }

  function hosts(): Output {
    return { kind: 'listing', links: hostLinks() }
  }

  function resourceChain(resource: Resource): Resource[] {
    const chain = [resource]
    for (let path = parentPath(resource.path); path !== '/'; path = parentPath(path)) {
      const parent = state.host?.resources.find((item) => item.path === path)
      if (parent) chain.unshift(parent)
    }
    return chain
  }

  function pathAction(resource: Resource): Action {
    return resource.type === 'directory'
      ? { type: 'ls', path: resource.path }
      : { type: 'cat', path: resource.path }
  }

  function suggestions(): string[] {
    const contextual = [
      ...hostLinks().map(({ action }) => action),
      ...(state.host?.resources ?? [])
        .filter((item) => resourceChain(item).every(({ discover }) => allows(discover)))
        .map(pathAction),
    ]
    const commands = commandHelp
      .map(([usage]) => usage.split(' ')[0])
      .filter(
        (command) => command !== 'login' || (state.host?.login && allows(state.host.login.access)),
      )
    return [...commands, ...contextual.map((action) => actionCommand(action)!)]
  }

  function apply(effects: Effect[], output: Output[], kind: 'message' | 'auth') {
    let next = state
    for (const effect of effects) {
      switch (effect.type) {
        case 'session':
          next = { ...next, identity: effect.identity }
          break
        case 'flag':
          if (!next.flags.includes(effect.flag))
            next = { ...next, flags: [...next.flags, effect.flag] }
          break
        case 'message':
          output.push({ kind, text: effect.text })
          break
      }
    }
    state = next
  }

  function resourceAction(action: Extract<Action, { type: 'ls' | 'cat' }>): Response {
    if (!state.host) return error('Connect to a host first.')
    const raw = action.path ?? '/'
    if (!raw) return error('Enter a resource path.')
    const absolute = raw.startsWith('/') ? raw : '/' + raw
    const path =
      action.type === 'ls' && absolute.length > 2 ? absolute.replace(/\/$/u, '') : absolute
    const resource = state.host.resources.find((item) => item.path === path)
    const chain = resource ? resourceChain(resource) : []
    if ((path !== '/' && !resource) || chain.some(({ discover }) => !allows(discover)))
      return error(`No such resource: ${raw}`)
    const blocked = chain.find(({ access }) => !allows(access))
    if (blocked) return error(blocked.denied ?? `Permission denied: ${path}`)

    if (action.type === 'ls') {
      if (resource?.type === 'file') return error(`Expected a directory: ${path}`)
      const links = state.host.resources
        .filter((item) => parentPath(item.path) === path && allows(item.discover))
        .map((item) => ({
          label:
            item.path.slice(path === '/' ? 1 : path.length + 1) +
            (item.type === 'directory' ? '/' : ''),
          detail: allows(item.access) ? undefined : 'restricted',
          action: pathAction(item),
        }))
      return { output: [{ kind: 'listing', path, links }] }
    }

    if (resource?.type !== 'file') return error(`Expected a file: ${path}`)
    const { text, inspectLines } = resource
    const output: Output[] = [{ kind: 'file', path, text, inspectLines }]
    apply(resource.onRead, output, 'message')
    if (!state.completed && scenario.objective.read === resource.id) {
      state = { ...state, completed: true }
      output.push({ kind: 'objective', text: scenario.objective.message })
    }
    return { output }
  }

  async function dispatch(action: Action): Promise<Response> {
    if (action.type === 'reset') {
      state = start(false)
      pending = undefined
      return { clear: true, output: welcome() }
    }
    if (pending) return error('An action is in progress.')
    switch (action.type) {
      case 'help':
        return { output: [{ kind: 'help', connected: Boolean(state.host) }] }
      case 'hosts':
        return { output: [hosts()] }
      case 'connect': {
        const host = scenario.hosts.find(({ id }) => id === action.host)
        if (!host || (host.discover && !state.flags.includes(host.discover)))
          return error(`Unknown host: ${action.host}`)
        state = { ...state, host, identity: host.guest, editing: false }
        return { output: [message(host.welcome)] }
      }
      case 'ls':
      case 'cat':
        return resourceAction(action)
      case 'whoami':
        return { output: [message(`${state.identity.user} · ${state.identity.role}`)] }
      case 'logout':
        if (!state.host) return error('Connect to a host first.')
        state = { ...state, identity: state.host.guest, editing: false }
        return { output: [message(`Session returned to ${state.identity.user}.`)] }
      case 'login': {
        const binding = state.host?.login
        if (!binding) return error('Login is unavailable in this session.')
        if (!allows(binding.access)) return error('Login is unavailable with the current access.')
        if (action.alias === undefined) {
          state = { ...state, editing: true }
          return { edit: true }
        }
        const before = state
        pending = before
        try {
          const result = await engine.evaluate(binding.program, { [binding.input]: action.alias })
          if (state !== before) return {}
          if (!result.ok) {
            const { error: issue } = result
            return error(
              issue.code === 'invalid_input' && issue.offset !== undefined
                ? 'This alias contains an unpaired surrogate. Open Code points to find and remove it.'
                : `${issue.code} · ${issue.message}`,
            )
          }
          if (!result.value.solved) {
            const feedback = binding.rejected.find(({ check }) =>
              result.value.checks.some(({ id, passed }) => id === check && !passed),
            )
            return { output: [{ kind: 'error', text: feedback?.message ?? binding.failure }] }
          }
          const output: Output[] = []
          apply(binding.success, output, 'auth')
          state = { ...state, editing: false }
          return { output }
        } finally {
          if (pending === before) pending = undefined
        }
      }
      case 'inspect': {
        if (action.character === undefined) return { inspectPrompt: true }
        const scalar = lookup(action.character)
        if (scalar === undefined)
          return error('Enter one Unicode scalar or a code point such as U+00E9.')
        const before = state
        pending = before
        try {
          const normalization = await Promise.all(
            forms.map(async (form) => ({ form, result: await engine.normalize(scalar, form) })),
          )
          if (state !== before) return {}
          return {
            output: [
              {
                kind: 'inspection',
                point: describe(scalar),
                category: scalarCategory(scalar),
                normalization,
              },
            ],
          }
        } finally {
          if (pending === before) pending = undefined
        }
      }
      case 'copy':
      case 'editPayload':
        if (unpairedSurrogate(action.text) !== undefined)
          return error('Expected valid Unicode text.')
        if (action.type === 'editPayload' && !state.editing)
          return error('Open a payload editor first.')
        return { transfer: action }
      case 'clear':
        return { clear: true }
      case 'closeEditor':
        if (state.editing) state = { ...state, editing: false }
        return {}
      case 'invalid':
        return error(action.message)
    }
  }

  return {
    get state() {
      return state
    },
    get canLogin() {
      return Boolean(state.host?.login && allows(state.host.login.access))
    },
    welcome,
    suggestions,
    dispatch,
  }
}
