import {
  forms,
  type Engine,
  type Normalization,
  type Result,
  type ScalarDetails,
} from '../types.ts'
import { createCampaign } from './campaign.ts'
import { actionCommand, commandHelp } from './commands.ts'
import {
  parentPath,
  type Effect,
  type Guard,
  type Host,
  type Identity,
  type MailMessage,
  type Resource,
  type Scenario,
} from './scenario.ts'
import { describe, lookup, scalarCategory, unpairedSurrogate, type Point } from './unicode.ts'

export type Action =
  | {
      type:
        | 'hosts'
        | 'whoami'
        | 'logout'
        | 'help'
        | 'clear'
        | 'reset'
        | 'resetCampaign'
        | 'campaign'
        | 'closeEditor'
    }
  | { type: 'connect'; host: string }
  | { type: 'ls'; path?: string }
  | { type: 'cat'; path: string }
  | { type: 'mail'; id?: string }
  | { type: 'login'; alias?: string }
  | { type: 'route' | 'reconcile'; payload?: string }
  | { type: 'scenario'; id: string }
  | { type: 'inspect'; character?: string }
  | { type: 'copy'; text: string }
  | { type: 'insertCommand'; text: string }
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
  details: Result<ScalarDetails>
  normalization: { form: Normalization; result: Result<string> }[]
}

export type Output =
  | { kind: 'message' | 'error' | 'auth' | 'objective'; text: string }
  | { kind: 'listing'; path?: string; title?: string; empty?: string; links: Link[] }
  | { kind: 'file'; path: string; text: string; inspectLines: number[]; inspectNotation: boolean }
  | { kind: 'mail'; path?: string; messages: MailMessage[] }
  | { kind: 'mailNotice' }
  | { kind: 'help'; connected: boolean; commands: string[] }
  | Inspection

export interface Session {
  host?: Host
  identity: Identity
  flags: readonly string[]
  completed: boolean
  editing: boolean
  deliveredMail: readonly string[]
  readMail: readonly string[]
}

export interface Response {
  output?: Output[]
  clear?: boolean
  inspectPrompt?: boolean
  transfer?: Extract<Action, { type: 'copy' | 'editPayload' | 'insertCommand' }>
  edit?: boolean
  enter?: string
}

export function createRuntime(
  scenario: Scenario,
  engine: Engine,
  campaign = createCampaign([scenario]),
) {
  const start = (completed: boolean): Session => {
    const host = scenario.hosts.find(({ id }) => id === scenario.initialHost)
    return {
      host,
      identity: host?.guest ?? scenario.local,
      flags: [],
      completed,
      editing: false,
      deliveredMail: campaign.delivered,
      readMail: campaign.read,
    }
  }
  let state = start(campaign.completed(scenario.id))
  let pending: Session | undefined
  const syncInbox = () => {
    state = { ...state, deliveredMail: campaign.delivered, readMail: campaign.read }
  }

  const message = (text: string): Output => ({ kind: 'message', text })
  const error = (text: string): Response => ({ output: [{ kind: 'error', text }] })
  const welcome = (): Output[] => [
    message(scenario.introduction),
    ...(state.deliveredMail.some((id) => !state.readMail.includes(id))
      ? [{ kind: 'mailNotice' } as const]
      : []),
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

  function inboxAction(id?: string): Response {
    if (!campaign.hasInbox) return error('No local inbox is configured.')
    if (id === undefined) {
      const links = state.deliveredMail.map((id): Link => {
        const message = campaign.message(id)!
        return {
          label: message.subject,
          detail: [id, message.from, state.readMail.includes(id) ? 'Read' : 'Unread'].join(' · '),
          action: { type: 'mail', id },
        }
      })
      return { output: [{ kind: 'listing', title: 'Inbox', empty: 'No messages.', links }] }
    }
    const message = campaign.message(id)
    if (!message) return error(`No such inbox message: ${id}`)
    if (!state.readMail.includes(id)) {
      campaign.markRead(id)
      syncInbox()
    }
    return { output: [{ kind: 'mail', messages: [message] }] }
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

  function destinationLinks(destinations: readonly Scenario[]): Link[] {
    return destinations.map(({ id, title, hosts, initialHost }) => ({
      label: title,
      detail: [
        hosts.find((host) => host.id === initialHost)?.id,
        campaign.completed(id) ? 'Complete' : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
      action: { type: 'scenario', id },
    }))
  }

  function availableOperation() {
    const operation = state.host?.operation
    return operation && allows(operation.access) ? operation : undefined
  }

  function commands() {
    return commandHelp
      .map(([usage]) => usage.split(' ')[0])
      .filter((command) => command !== 'mail' || campaign.hasInbox)
      .filter(
        (command) =>
          !['login', 'route', 'reconcile'].includes(command) ||
          command === availableOperation()?.command,
      )
  }

  function suggestions(): string[] {
    const contextual = [
      ...destinationLinks(campaign.destinations()).map(({ action }) => action),
      ...hostLinks().map(({ action }) => action),
      ...state.deliveredMail.map((id): Action => ({ type: 'mail', id })),
      ...(state.host?.resources ?? [])
        .filter((item) => resourceChain(item).every(({ discover }) => allows(discover)))
        .map(pathAction),
    ]
    return [...commands(), ...contextual.map((action) => actionCommand(action)!)]
  }

  function apply(effects: Effect[], output: Output[], kind: 'message' | 'auth') {
    let newMail = false
    for (const effect of effects) {
      switch (effect.type) {
        case 'session':
          state = { ...state, identity: effect.identity }
          break
        case 'flag':
          if (!state.flags.includes(effect.flag))
            state = { ...state, flags: [...state.flags, effect.flag] }
          break
        case 'message':
          output.push({ kind, text: effect.text })
          break
        case 'deliverMail':
          if (campaign.deliver(effect.message)) newMail = true
          break
        case 'resourceLink': {
          const resource = state.host?.resources.find(({ id }) => id === effect.resource)
          if (
            resource &&
            resourceChain(resource).every(
              ({ discover, access }) => allows(discover) && allows(access),
            )
          )
            output.push({
              kind: 'listing',
              title: 'Available resource',
              links: [{ label: resource.path, action: pathAction(resource) }],
            })
          break
        }
      }
    }
    if (newMail) {
      syncInbox()
      output.push({ kind: 'mailNotice' })
    }
  }

  function resourceAction(action: Extract<Action, { type: 'ls' | 'cat' }>): Response {
    if (!state.host) return error('Connect to a host first.')
    const raw = action.path ?? '/'
    if (!raw) return error('Enter a resource path.')
    const absolute = raw.startsWith('/')
      ? raw
      : '/' + (raw === '.' ? '' : raw.replace(/^\.\//u, ''))
    const path =
      action.type === 'ls' && absolute.length > 2 ? absolute.replace(/\/$/u, '') : absolute
    const resource = state.host.resources.find((item) => item.path === path)
    const chain = resource ? resourceChain(resource) : []
    if ((path !== '/' && !resource) || chain.some(({ discover }) => !allows(discover)))
      return error(`No such resource: ${raw}`)
    const blocked = chain.find(({ access }) => !allows(access))
    if (blocked) return error(blocked.denied ?? `Permission denied: ${path}`)

    if (action.type === 'ls') {
      if (resource && resource.type !== 'directory') return error(`Expected a directory: ${path}`)
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

    if (!resource || resource.type === 'directory') return error(`Expected a file: ${path}`)
    const output: Output[] = [
      resource.type === 'mail'
        ? { kind: 'mail', path, messages: resource.messages }
        : {
            kind: 'file',
            path,
            text: resource.text,
            inspectLines: resource.inspectLines,
            inspectNotation: resource.inspectNotation,
          },
    ]
    apply(resource.onRead, output, 'message')
    if (!state.completed && scenario.objective.read === resource.id) {
      state = { ...state, completed: true }
      output.push({ kind: 'objective', text: scenario.objective.message })
      const { destinations, newMail } = campaign.complete(scenario.id)
      if (newMail) {
        syncInbox()
        output.push({ kind: 'mailNotice' })
      }
      if (destinations.length)
        output.push({
          kind: 'listing',
          title: 'New destination',
          links: destinationLinks(destinations),
        })
    }
    return { output }
  }

  async function dispatch(action: Action): Promise<Response> {
    if (action.type === 'reset') {
      state = start(false)
      pending = undefined
      return { clear: true, output: welcome() }
    }
    if (action.type === 'resetCampaign') {
      pending = undefined
      const enter = campaign.reset()
      state = start(false)
      return { enter }
    }
    if (pending) return error('An action is in progress.')
    switch (action.type) {
      case 'help':
        return { output: [{ kind: 'help', connected: Boolean(state.host), commands: commands() }] }
      case 'campaign':
        return {
          output: [
            {
              kind: 'listing',
              title: campaign.finished ? 'Campaign complete' : 'Discovered destinations',
              links: [
                ...destinationLinks(campaign.destinations()),
                { label: 'Reset campaign…', action: { type: 'resetCampaign' } },
              ],
            },
          ],
        }
      case 'scenario':
        return campaign.selectable(action.id)
          ? { enter: action.id }
          : error(`Unknown destination: ${action.id}`)
      case 'hosts':
        return { output: [hosts()] }
      case 'mail':
        return inboxAction(action.id)
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
      case 'login':
      case 'route':
      case 'reconcile': {
        const binding = availableOperation()
        if (!binding || binding.command !== action.type)
          return error(`${action.type} is unavailable with the current access.`)
        const payload = action.type === 'login' ? action.alias : action.payload
        if (payload === undefined) {
          state = { ...state, editing: true }
          return { edit: true }
        }
        const before = state
        pending = before
        try {
          const result = await engine.evaluate(binding.program, { [binding.input]: payload })
          if (state !== before) return {}
          if (!result.ok) {
            const { error: issue } = result
            return error(
              issue.code === 'invalid_input' && issue.offset !== undefined
                ? 'This payload contains an unpaired surrogate. Open Code points to find and remove it.'
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
          apply(binding.success, output, action.type === 'login' ? 'auth' : 'message')
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
          const [details, normalization] = await Promise.all([
            engine.inspectScalar(scalar),
            Promise.all(
              forms.map(async (form) => ({ form, result: await engine.normalize(scalar, form) })),
            ),
          ])
          if (state !== before) return {}
          return {
            output: [
              {
                kind: 'inspection',
                point: describe(scalar),
                category: scalarCategory(scalar),
                details,
                normalization,
              },
            ],
          }
        } finally {
          if (pending === before) pending = undefined
        }
      }
      case 'copy':
      case 'insertCommand':
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
    get operation() {
      return availableOperation()
    },
    welcome,
    suggestions,
    dispatch,
  }
}
