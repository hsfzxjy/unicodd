import {
  forms,
  type Engine,
  type EngineError,
  type Normalization,
  type Result,
  type ScalarDetails,
} from '../types.ts'
import { createCampaign, validHandoff } from './campaign.ts'
import { actionCommand, commandHelp, operationArity } from './commands.ts'
import {
  dossierArity,
  dossierCandidates,
  dossierReview,
  dossierStages,
  isDossierCommand,
  sameReceipt,
  stagesDossierCandidate,
  validArguments,
  validDossierReceipt,
  type DossierCommand,
  type DossierReceipt,
} from './dossier.ts'
import {
  archiveRows,
  type Handoff,
  type RecoveryCommand,
  type RecoveryContext,
  type RecoveryRow,
} from './recovery.ts'
import {
  parentPath,
  type Effect,
  type FileFormat,
  type Guard,
  type Host,
  type Identity,
  type MailMessage,
  type Milestone,
  type Resource,
  type Scenario,
} from './scenario.ts'
import { describe, lookup, scalarCategory, unpairedSurrogate, type Point } from './unicode.ts'

export type Action =
  | {
      type:
        'hosts' | 'whoami' | 'logout' | 'help' | 'clear' | 'reset' | 'resetCampaign' | 'campaign'
    }
  | { type: 'connect'; host: string }
  | { type: 'ls'; path?: string }
  | { type: 'cat'; path: string }
  | { type: 'mail'; id?: string }
  | { type: 'login'; alias?: string }
  | { type: 'reconcile'; payload?: string }
  | { type: 'route' | 'reconstruct' | RecoveryCommand | DossierCommand; payloads?: string[] }
  | { type: 'scenario'; id: string }
  | { type: 'inspect'; character?: string }
  | { type: 'copy'; text: string }
  | { type: 'insertCommand'; text: string }
  | { type: 'editPayload'; mode: 'insert' | 'replace'; text: string }
  | { type: 'invalid'; message: string }

export interface Link {
  label: string
  detail?: string
  tracking?: { kind: 'host' | 'mail' | 'resource'; key: string }
  action: Action
}

export interface Inspection {
  kind: 'inspection'
  point: Point
  category?: string
  details: Result<ScalarDetails>
  normalization: { form: Normalization; result: Result<string> }[]
}

export interface ProgressTransition extends Milestone {
  scenario: string
  scope: 'subobjective' | 'scenario'
  action: Action['type']
}

export type Output =
  | { kind: 'message' | 'error' | 'auth'; text: string }
  | { kind: 'objective'; text: string; progress?: ProgressTransition }
  | { kind: 'milestone'; text: string; progress: ProgressTransition }
  | { kind: 'listing'; path?: string; title?: string; empty?: string; links: Link[] }
  | {
      kind: 'file'
      path: string
      text: string
      inspectLines: number[]
      inspectNotation: boolean
      format?: FileFormat
    }
  | { kind: 'mail'; path?: string; messages: MailMessage[] }
  | { kind: 'mailNotice' }
  | { kind: 'help'; connected: boolean; commands: string[] }
  | { kind: 'report'; rows: RecoveryRow[] }
  | Inspection

export interface Session {
  host?: Host
  identity: Identity
  flags: readonly string[]
  completed: boolean
  deliveredMail: readonly string[]
  readMail: readonly string[]
  visitedHosts: readonly string[]
  readResources: readonly string[]
  recovery?: Readonly<Record<string, { context: RecoveryContext; handoff?: Handoff }>>
  dossier?: Readonly<Record<string, DossierDraft>>
}

interface DossierDraft {
  snapshot: string
  candidate?: string[]
  receipt?: DossierReceipt
}

export interface RuntimeSnapshot {
  host?: string
  identity: Identity
  flags: readonly string[]
  completed: boolean
  recovery?: Session['recovery']
  dossier?: Session['dossier']
  dataset?: { incident: string; revision: string }
}

export function linkStatus(
  link: Link,
  state: Pick<Session, 'visitedHosts' | 'readMail' | 'readResources'>,
): 'New' | 'Unread' | 'Read' | undefined {
  const tracking = link.tracking
  if (!tracking) return
  if (tracking.kind === 'host') return state.visitedHosts.includes(tracking.key) ? undefined : 'New'
  const read = tracking.kind === 'mail' ? state.readMail : state.readResources
  return read.includes(tracking.key) ? 'Read' : 'Unread'
}

export interface Response {
  output?: Output[]
  transient?: boolean
  clear?: boolean
  compose?: import('./commands.ts').CommandName
  transfer?: Extract<Action, { type: 'copy' | 'editPayload' | 'insertCommand' }>
  enter?: string
}

export function createRuntime(
  scenario: Scenario,
  engine: Engine,
  campaign = createCampaign([scenario]),
  saved?: RuntimeSnapshot,
) {
  const hostKey = (host: Host, destination = scenario.id) => destination + '/' + host.id
  const resourceKey = (host: Host, resource: Resource) => hostKey(host) + '/' + resource.id
  const dossierStage = scenario.objective.dossier
  const dossierReportFlag = dossierStage
    ? scenario.hosts
        .flatMap(({ resources }) => resources)
        .find(({ id }) => id === scenario.objective.read)?.access?.flag
    : undefined
  const start = (completed: boolean): Session => {
    const host = scenario.hosts.find(({ id }) => id === scenario.initialHost)
    if (host) campaign.visitHost(hostKey(host))
    const kind = campaign.handoff(scenario.id)?.kind
    const released = kind === 'release'
    const final = host?.recovery?.find(({ command }) => command === scenario.objective.action)
    const archiveReport =
      (kind && kind === scenario.objective.handoff) || campaign.dossierReceipt(scenario.id)
        ? scenario.hosts
            .flatMap(({ resources }) => resources)
            .find(({ id }) => id === scenario.objective.read)
        : undefined
    return {
      host,
      identity: host?.guest ?? scenario.local,
      flags: released
        ? (final?.success.flatMap((effect) => (effect.type === 'flag' ? [effect.flag] : [])) ?? [])
        : [archiveReport?.access?.flag, archiveReport?.discover?.flag].filter(
            (flag): flag is string => Boolean(flag),
          ),
      completed: completed || released || Boolean(archiveReport),
      deliveredMail: campaign.delivered,
      readMail: campaign.read,
      visitedHosts: campaign.visitedHosts,
      readResources: campaign.readResources,
    }
  }
  let state = start(campaign.completed(scenario.id))
  if (saved && typeof saved.completed === 'boolean' && Array.isArray(saved.flags)) {
    const host = scenario.hosts.find(({ id }) => id === saved.host)
    if (saved.host === undefined || host) {
      const guest = host?.guest ?? scenario.local
      const identities = host
        ? [
            ...host.operations.flatMap(({ success }) => success),
            ...(host.recovery ?? []).flatMap(({ success }) => success),
            ...host.resources.flatMap((resource) =>
              resource.type === 'directory' ? [] : resource.onRead,
            ),
          ].flatMap((effect) => (effect.type === 'session' ? [effect.identity] : []))
        : []
      const dataset = scenario.recovery?.dataset
      const recovery =
        dataset &&
        saved.dataset?.incident === dataset.incident &&
        saved.dataset.revision === dataset.revision &&
        saved.recovery
          ? Object.fromEntries(
              scenario.hosts.flatMap(({ id, recovery }) => {
                const staged = saved.recovery?.[id]
                return recovery?.length &&
                  staged?.context &&
                  typeof staged.context === 'object' &&
                  !Array.isArray(staged.context)
                  ? [
                      [
                        id,
                        {
                          context: staged.context,
                          handoff: validHandoff(staged.handoff) ? staged.handoff : undefined,
                        },
                      ],
                    ]
                  : []
              }),
            )
          : undefined
      state = {
        ...state,
        host,
        identity:
          identities.find(
            ({ user, role }) => user === saved.identity?.user && role === saved.identity.role,
          ) ?? guest,
        flags: saved.flags.filter(
          (flag) => scenario.flags.includes(flag) && flag !== dossierReportFlag,
        ),
        completed: scenario.dossier ? campaign.completed(scenario.id) : saved.completed,
        recovery,
        dossier:
          scenario.dossier &&
          dossierStage &&
          Object.fromEntries(
            scenario.hosts.flatMap(({ id }) => {
              const draft = saved.dossier?.[id]
              if (draft?.snapshot !== scenario.dossier!.snapshot) return []
              return [
                [
                  id,
                  {
                    snapshot: draft.snapshot,
                    candidate: validArguments(
                      draft.candidate,
                      dossierArity[dossierCandidates[dossierStage]],
                    )
                      ? draft.candidate
                      : undefined,
                    receipt: validDossierReceipt(draft.receipt, draft.snapshot, dossierStage)
                      ? draft.receipt
                      : undefined,
                  },
                ],
              ]
            }),
          ),
      }
      if (
        dossierReportFlag &&
        (campaign.completed(scenario.id) || (host && state.dossier?.[host.id]?.receipt))
      ) {
        state = { ...state, flags: [...state.flags, dossierReportFlag] }
      }
    }
  }
  const milestoneKey = (id: string) => scenario.id + '/milestone/' + id
  const reached = (effect: Effect, session: Session) =>
    effect.type === 'flag'
      ? session.flags.includes(effect.flag)
      : effect.type === 'session' && session.identity.role === effect.identity.role
  // Migrate previously reached milestones from an older, still-active host session.
  if (saved && !campaign.completed(scenario.id) && state.host) {
    const { operations, recovery, resources, guest } = state.host
    for (const effect of [
      ...operations.flatMap(({ success }) => success),
      ...(recovery ?? []).flatMap(({ success }) => success),
      ...resources.flatMap((resource) => (resource.type === 'directory' ? [] : resource.onRead)),
    ]) {
      if (
        (effect.type === 'flag' ||
          (effect.type === 'session' && effect.identity.role !== guest.role)) &&
        effect.milestone &&
        reached(effect, state)
      )
        campaign.recordMilestone(milestoneKey(effect.milestone.id))
    }
  }
  let pending: Session | undefined
  const syncInbox = () => {
    state = { ...state, deliveredMail: campaign.delivered, readMail: campaign.read }
  }

  const message = (text: string): Output => ({ kind: 'message', text })
  const error = (text: string): Response => ({ output: [{ kind: 'error', text }] })
  const isTransient = (code: EngineError['code']) =>
    code === 'engine_unavailable' || code === 'evaluation_failure'
  const welcome = (): Output[] => [
    message(scenario.introduction),
    ...(campaign.staleDossier(scenario.id)
      ? [
          message(
            'A saved dossier review no longer matches the available evidence. Run verification again.',
          ),
        ]
      : []),
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
      .map((host) => ({
        label: host.id,
        detail: host.name,
        tracking: { kind: 'host', key: hostKey(host) },
        action: { type: 'connect', host: host.id },
      }))
  }

  function hostDirectory(): Link[] {
    return [
      ...hostLinks(),
      ...destinationLinks(campaign.destinations().filter(({ id }) => id !== scenario.id)),
    ]
  }

  function hosts(): Output {
    return { kind: 'listing', links: hostDirectory(), empty: 'No known hosts.' }
  }

  function inboxAction(id?: string): Response {
    if (!campaign.hasInbox) return error('No local inbox is configured.')
    if (id === undefined) {
      const links = state.deliveredMail.map((id): Link => {
        const message = campaign.message(id)!
        return {
          label: message.subject,
          detail: [id, message.from].join(' · '),
          tracking: { kind: 'mail', key: id },
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

  function resourceLink(host: Host, resource: Resource, label: string): Link {
    return {
      label,
      detail: allows(resource.access) ? undefined : 'restricted',
      tracking:
        resource.type === 'directory'
          ? undefined
          : { kind: 'resource', key: resourceKey(host, resource) },
      action: pathAction(resource),
    }
  }

  function destinationLinks(destinations: readonly Scenario[]): Link[] {
    return destinations.map(({ id, title, hosts, initialHost }) => {
      const host =
        hosts.find((candidate) => candidate.id === initialHost) ??
        hosts.find((candidate) => !candidate.discover)
      return {
        label: title,
        detail: [host?.id, campaign.completed(id) ? 'Complete' : undefined]
          .filter(Boolean)
          .join(' · '),
        tracking: host ? { kind: 'host', key: hostKey(host, id) } : undefined,
        action: { type: 'scenario', id },
      }
    })
  }

  function availableOperations() {
    const released = campaign.handoff(scenario.id)?.kind === 'release'
    return [...(state.host?.operations ?? []), ...(state.host?.recovery ?? [])].filter(
      ({ command, access }) =>
        allows(access) && (!released || command === scenario.objective.action),
    )
  }

  function commands() {
    const available = new Set<string>(availableOperations().map(({ command }) => command))
    return commandHelp
      .map(([usage]) => usage.split(' ')[0])
      .filter((command) => command !== 'mail' || campaign.hasInbox)
      .filter((command) => !Object.hasOwn(operationArity, command) || available.has(command))
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

  function apply(
    effects: Effect[],
    output: Output[],
    kind: 'message' | 'auth',
    action: Action['type'],
  ) {
    const before = state
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
        case 'clearFlag':
          if (state.flags.includes(effect.flag))
            state = { ...state, flags: state.flags.filter((flag) => flag !== effect.flag) }
          break
        case 'message':
          output.push({ kind, text: effect.text })
          break
        case 'deliverMail':
          if (campaign.deliver(effect.message)) newMail = true
          break
        case 'resourceLink': {
          const host = state.host
          const resource = host?.resources.find(({ id }) => id === effect.resource)
          if (
            host &&
            resource &&
            resourceChain(resource).every(
              ({ discover, access }) => allows(discover) && allows(access),
            )
          )
            output.push({
              kind: 'listing',
              title: 'Available resource',
              links: [resourceLink(host, resource, resource.path)],
            })
          break
        }
      }
    }
    if (state !== before && !campaign.completed(scenario.id)) {
      for (const effect of effects) {
        if (effect.type !== 'flag' && effect.type !== 'session') continue
        const milestone = effect.milestone
        if (!milestone || reached(effect, before) || !reached(effect, state)) continue
        const id = milestoneKey(milestone.id)
        if (campaign.recordMilestone(id))
          output.push({
            kind: 'milestone',
            text: milestone.text,
            progress: { ...milestone, id, scenario: scenario.id, scope: 'subobjective', action },
          })
      }
    }
    if (newMail) {
      syncInbox()
      output.push({ kind: 'mailNotice' })
    }
  }

  function completeObjective(
    output: Output[],
    action: Action['type'],
    handoff?: Handoff,
    receipt?: DossierReceipt,
  ) {
    if (state.completed) {
      if (handoff) campaign.complete(scenario.id, handoff)
      return
    }
    const first = !campaign.completed(scenario.id)
    const { destinations, newMail } = campaign.complete(scenario.id, handoff, receipt)
    if (!campaign.completed(scenario.id)) return
    state = { ...state, completed: true }
    const text = scenario.objective.message
    output.push(
      first && scenario.objective.completionBand
        ? {
            kind: 'objective',
            text,
            progress: {
              id: scenario.id + '/complete',
              scenario: scenario.id,
              scope: 'scenario',
              title: scenario.title + ' · Complete',
              text,
              action,
            },
          }
        : { kind: 'objective', text },
    )
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

  async function resourceAction(
    action: Extract<Action, { type: 'ls' | 'cat' }>,
  ): Promise<Response> {
    const host = state.host
    if (!host) return error('Connect to a host first.')
    const raw = action.path ?? '/'
    if (!raw) return error('Enter a resource path.')
    const absolute = raw.startsWith('/')
      ? raw
      : '/' + (raw === '.' ? '' : raw.replace(/^\.\//u, ''))
    const path =
      action.type === 'ls' && absolute.length > 2 ? absolute.replace(/\/$/u, '') : absolute
    const resource = host.resources.find((item) => item.path === path)
    const chain = resource ? resourceChain(resource) : []
    if ((path !== '/' && !resource) || chain.some(({ discover }) => !allows(discover)))
      return error(`No such resource: ${raw}`)
    const blocked = chain.find(({ access }) => !allows(access))
    if (blocked) return error(blocked.denied ?? `Permission denied: ${path}`)

    if (action.type === 'ls') {
      if (resource && resource.type !== 'directory') return error(`Expected a directory: ${path}`)
      const links = host.resources
        .filter((item) => parentPath(item.path) === path && allows(item.discover))
        .map((item) =>
          resourceLink(
            host,
            item,
            item.path.slice(path === '/' ? 1 : path.length + 1) +
              (item.type === 'directory' ? '/' : ''),
          ),
        )
      return { output: [{ kind: 'listing', path, links }] }
    }

    if (!resource || resource.type === 'directory') return error(`Expected a file: ${path}`)
    const objective = scenario.objective.read === resource.id
    const handoff = campaign.handoff(scenario.id) ?? state.recovery?.[host.id]?.handoff
    if (objective && scenario.objective.handoff && handoff?.kind !== scenario.objective.handoff)
      return error(resource.denied ?? 'Run the verification operation to produce this report.')
    let dossierReport: Extract<Output, { kind: 'report' }> | undefined
    let receipt: DossierReceipt | undefined
    if (objective && scenario.objective.dossier && scenario.dossier) {
      const stored = campaign.dossierReceipt(scenario.id) ?? state.dossier?.[host.id]?.receipt
      if (!stored) return error(resource.denied ?? 'Verify the dossier before opening this report.')
      const before = state
      pending = before
      try {
        const prior = scenario.dossier.prior
        const checked = await engine.runDossier(
          dossierReview(scenario, stored, prior ? campaign.dossierReceipt(prior) : undefined),
        )
        if (state !== before) return {}
        if (!checked.ok)
          return { ...error(checked.error.message), transient: isTransient(checked.error.code) }
        if (!sameReceipt(checked.value.handoff, stored))
          return error(
            'The stored review does not match this archive snapshot. Run verification again.',
          )
        receipt = checked.value.handoff!
        dossierReport = { kind: 'report', rows: checked.value.rows }
      } finally {
        if (pending === before) pending = undefined
      }
    }
    if (campaign.markResourceRead(resourceKey(host, resource)))
      state = { ...state, readResources: campaign.readResources }
    const output: Output[] = [
      resource.type === 'mail'
        ? { kind: 'mail', path, messages: resource.messages }
        : {
            kind: 'file',
            path,
            text: resource.text,
            inspectLines: resource.inspectLines,
            inspectNotation: resource.inspectNotation,
            ...(resource.format ? { format: resource.format } : {}),
          },
    ]
    apply(resource.onRead, output, 'message', action.type)
    if (objective) {
      if (scenario.objective.handoff && handoff)
        output.push({ kind: 'report', rows: archiveRows(handoff) })
      if (dossierReport) output.push(dossierReport)
      completeObjective(output, action.type, handoff, receipt)
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
              title: campaign.finished
                ? 'All available scenarios complete'
                : 'Discovered destinations',
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
        campaign.visitHost(hostKey(host))
        state = { ...state, host, identity: host.guest, visitedHosts: campaign.visitedHosts }
        return { output: [message(host.welcome)] }
      }
      case 'ls':
      case 'cat':
        return resourceAction(action)
      case 'whoami':
        return { output: [message(`${state.identity.user} · ${state.identity.role}`)] }
      case 'logout':
        if (!state.host) return error('Connect to a host first.')
        state = { ...state, identity: state.host.guest }
        return { output: [message(`Session returned to ${state.identity.user}.`)] }
      case 'login':
      case 'route':
      case 'reconstruct':
      case 'reconcile':
      case 'collate':
      case 'replay':
      case 'recover':
      case 'casing':
      case 'lookup':
      case 'probe':
      case 'bind':
      case 'prepare':
      case 'preview':
      case 'verify':
      case 'commit':
      case 'resolve':
      case 'dispatch':
      case 'capture':
      case 'deframe':
      case 'identifier':
      case 'search':
      case 'tokens':
      case 'select':
      case 'source':
      case 'map-span':
      case 'json-check':
      case 'redact':
      case 'surfaces':
      case 'audit':
      case 'targets':
      case 'probe-path':
      case 'assets':
      case 'extract':
      case 'roundtrip':
      case 'mirror': {
        const binding = availableOperations().find(({ command }) => command === action.type)
        if (!binding) return error(`${action.type} is unavailable with the current access.`)
        const payload =
          action.type === 'login'
            ? action.alias
            : action.type === 'reconcile'
              ? action.payload
              : action.payloads
        if (payload === undefined && operationArity[action.type]) {
          return { compose: action.type }
        }
        const values = typeof payload === 'string' ? [payload] : (payload ?? [])
        if (values.length !== operationArity[action.type])
          return error('Supply all arguments for this operation.')
        let index = 0
        const inputs = Object.fromEntries(
          binding.fields.map(({ input, fixed }) => [input, fixed ?? values[index++]]),
        )
        const before = state
        const hostId = before.host!.id
        const staged = state.recovery?.[hostId]
        const recovery = scenario.recovery
        const draft = state.dossier?.[hostId]
        const dossier = scenario.dossier
        pending = before
        try {
          const result =
            'program' in binding
              ? await engine.evaluate(binding.program, inputs)
              : isDossierCommand(binding.command)
                ? await engine.runDossier({
                    version: 1,
                    dataset: dossier!.dataset,
                    command: binding.command,
                    args: values,
                    candidate: draft?.candidate,
                    prior: dossier?.prior ? campaign.dossierReceipt(dossier.prior) : undefined,
                  })
                : await engine.runRecovery({
                    version: 1,
                    dataset: recovery!.dataset,
                    command: binding.command,
                    args: values,
                    context: staged?.context,
                    prior: recovery?.prior ? campaign.handoff(recovery.prior) : undefined,
                    committed: campaign.handoff(scenario.id),
                    direct: campaign.direct(scenario.id),
                  })
          if (state !== before) return {}
          if (!result.ok) {
            const { error: issue } = result
            const arg = /^args\.(\d+)$/u.exec(issue.path ?? '')
            const field = arg
              ? binding.fields[Number(arg[1])]
              : binding.fields.find(({ input }) => issue.path === 'inputs.' + input)
            const response = error(
              issue.code === 'invalid_input' && issue.offset !== undefined
                ? (field?.label ?? 'Payload') +
                    ' contains an unpaired surrogate. Open Code points to find and remove it.'
                : `${field?.label ?? issue.code} · ${issue.message}`,
            )
            if (isTransient(issue.code)) response.transient = true
            return response
          }
          const output: Output[] = []
          let handoff: Handoff | undefined
          if ('candidate' in result.value) {
            const { rows, candidate, handoff } = result.value
            state = {
              ...state,
              dossier: {
                ...state.dossier,
                [hostId]: {
                  snapshot: dossier!.snapshot,
                  candidate: candidate ?? undefined,
                  receipt:
                    handoff ??
                    (isDossierCommand(action.type) &&
                    !stagesDossierCandidate(action.type) &&
                    action.type !== dossierStages[scenario.objective.dossier!]
                      ? draft?.receipt
                      : undefined),
                },
              },
              flags:
                'invalidates' in binding
                  ? state.flags.filter(
                      (flag) =>
                        !binding.invalidates.includes(flag) || campaign.completed(scenario.id),
                    )
                  : state.flags,
            }
            if (rows.length) output.push({ kind: 'report', rows })
          } else if ('rows' in result.value) {
            const { rows, context, handoff: next } = result.value
            handoff = next
            state = {
              ...state,
              recovery: {
                ...state.recovery,
                [hostId]: { context, handoff: handoff ?? staged?.handoff },
              },
              flags:
                'invalidates' in binding
                  ? state.flags.filter((flag) => !binding.invalidates.includes(flag))
                  : state.flags,
            }
            if (rows.length) output.push({ kind: 'report', rows })
          }
          if (!result.value.solved) {
            const messages = new Map<string | undefined, string>()
            for (const { check, message, stage } of binding.rejected) {
              if (
                !messages.has(stage) &&
                result.value.checks.some(({ id, passed }) => id === check && !passed)
              )
                messages.set(stage, message)
            }
            output.push({
              kind: 'error',
              text: [...messages.values()].join('\n') || binding.failure,
            })
            return { output }
          }
          if (
            scenario.objective.action === action.type &&
            campaign.handoff(scenario.id)?.kind === 'release'
          ) {
            output.push(message('Transaction already applied.'))
            return { output }
          }
          if (scenario.objective.action === action.type && output.length) {
            const report = output.pop()!
            apply(binding.success, output, 'message', action.type)
            output.push(report)
          } else {
            apply(
              binding.success,
              output,
              action.type === 'login' ? 'auth' : 'message',
              action.type,
            )
          }
          if (scenario.objective.action === action.type)
            completeObjective(output, action.type, handoff)
          return { output }
        } finally {
          if (pending === before) pending = undefined
        }
      }
      case 'inspect': {
        if (action.character === undefined) return { compose: 'inspect' }
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
          const response: Response = {
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
          if (
            [details, ...normalization.map(({ result }) => result)].some(
              (result) => !result.ok && isTransient(result.error.code),
            )
          )
            response.transient = true
          return response
        } finally {
          if (pending === before) pending = undefined
        }
      }
      case 'copy':
      case 'insertCommand':
      case 'editPayload':
        if (unpairedSurrogate(action.text) !== undefined)
          return error('Expected valid Unicode text.')
        return { transfer: action }
      case 'clear':
        return { clear: true }
      case 'invalid':
        return error(action.message)
    }
  }

  return {
    snapshot(): RuntimeSnapshot {
      const dataset = scenario.recovery?.dataset
      return {
        host: state.host?.id,
        identity: state.identity,
        flags: state.flags,
        completed: state.completed,
        recovery: state.recovery,
        dossier: state.dossier,
        dataset: dataset && { incident: dataset.incident, revision: dataset.revision },
      }
    },
    get state() {
      return state
    },
    get operations() {
      return availableOperations()
    },
    get hostStatus() {
      return state.host?.status.map(({ label, value, after }) => {
        const reached = after && allows(after)
        return { label, value: reached ? after.value : value, reached }
      })
    },
    get newHosts() {
      return hostDirectory().filter((link) => linkStatus(link, state) === 'New').length
    },
    welcome,
    suggestions,
    dispatch,
  }
}
