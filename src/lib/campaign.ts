import type { MailMessage, Scenario } from './scenario.ts'
import type { Handoff } from './recovery.ts'
import type { Engine } from '../types.ts'
import { dossierReview, sameReceipt, validDossierReceipt, type DossierReceipt } from './dossier.ts'
import type { LevelSave } from './workspace.ts'

export const campaignKey = 'unicodd.campaign'

export interface CampaignProgress {
  completed: number
  total: number
}
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface CampaignSnapshot {
  version: 1
  current: string
  completed: string[]
  delivered: string[]
  read: string[]
  visitedHosts?: string[]
  readResources?: string[]
  milestones?: string[]
  handoffs?: Record<string, Handoff>
  dossierReceipts?: Record<string, DossierReceipt>
}

interface Save extends CampaignSnapshot {
  levels?: Record<string, LevelSave>
}

export function validHandoff(handoff: Handoff | undefined): handoff is Handoff {
  if (!handoff || handoff.version !== 1) return false
  const text = (value: unknown) => typeof value === 'string' && value.length > 0
  const approval = (value: unknown) =>
    value !== null &&
    typeof value === 'object' &&
    ['registration', 'owner', 'receipt'].every((key) =>
      text((value as Record<string, unknown>)[key]),
    )
  const identities = (value: Extract<Handoff, { kind: 'release' }>['identities']) =>
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(
      (entry) => entry && text(entry.canonical) && text(entry.name) && approval(entry.approval),
    )
  const outbox = (value: Extract<Handoff, { kind: 'release' }>['outbox']) =>
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(
      (receipt) =>
        receipt &&
        receipt.status === 'QUEUED' &&
        [
          'id',
          'registration',
          'owner',
          'archiveId',
          'payload',
          'digest',
          'endpoint',
          'path',
          'ackMarker',
          'ackDigest',
        ].every((key) => text(receipt[key as keyof typeof receipt])),
    )
  const bytes = (value: unknown) =>
    Array.isArray(value) &&
    value.length <= 4096 &&
    value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  const dispatch = (value: Extract<Handoff, { kind: 'dispatch' }>['evidence']) =>
    value?.release &&
    identities(value.release.identities) &&
    outbox(value.release.outbox) &&
    bytes(value.capture) &&
    text(value.captureDigest) &&
    Array.isArray(value.routes) &&
    value.routes.length === 2 &&
    value.routes.every(
      (route) =>
        route &&
        text(route.receipt) &&
        text(route.endpoint) &&
        text(route.host) &&
        text(route.path) &&
        route.status === 202,
    )
  const ingestion = (value: Extract<Handoff, { kind: 'ingestion' }>['evidence']) =>
    dispatch(value?.dispatch) &&
    Array.isArray(value.frames) &&
    value.frames.length <= 24 &&
    value.frames.every(
      (frame) =>
        frame &&
        Number.isInteger(frame.offset) &&
        bytes(frame.payload) &&
        text(frame.digest) &&
        ['accepted', 'heartbeat', 'quarantined'].includes(frame.disposition?.kind),
    )
  switch (handoff.kind) {
    case 'appeals':
      return Array.isArray(handoff.records) && handoff.records.every(text)
    case 'approvals':
      return Array.isArray(handoff.approvals) && handoff.approvals.every(approval)
    case 'release':
      return (
        identities(handoff.identities) && (handoff.outbox === undefined || outbox(handoff.outbox))
      )
    case 'dispatch':
      return Boolean(dispatch(handoff.evidence))
    case 'ingestion':
      return Boolean(ingestion(handoff.evidence))
    case 'mirror':
      return (
        Boolean(ingestion(handoff.evidence?.ingestion)) &&
        Array.isArray(handoff.evidence.records) &&
        handoff.evidence.records.length <= 26 &&
        handoff.evidence.records.every(
          (record) =>
            record &&
            text(record.id) &&
            text(record.handle) &&
            text(record.displayLabel) &&
            text(record.owner),
        )
      )
    default:
      return false
  }
}

function restoreRelease(scenario: Scenario, previous?: Handoff): Handoff | undefined {
  const dataset = scenario.recovery?.dataset
  if (scenario.objective.action !== 'commit' || !dataset?.archive) return previous
  if (previous?.kind === 'release' && previous.outbox) return previous
  const identities =
    previous?.kind === 'release'
      ? previous.identities
      : dataset.registrations.flatMap(({ id, name, owner }) => {
          const approval = dataset.receipts.find(
            (entry) =>
              entry.registration === id &&
              entry.owner === owner &&
              entry.verified &&
              !entry.diagnostic,
          )
          return approval
            ? [{ canonical: id, name, approval: { registration: id, owner, receipt: approval.id } }]
            : []
        })
  return {
    kind: 'release',
    version: 1,
    incident: dataset.incident,
    revision: dataset.revision,
    identities,
    outbox: dataset.archive.sources,
  }
}

function decode(raw: string | null): Save | undefined {
  try {
    const save = JSON.parse(raw ?? 'null') as Partial<Save> | null
    if (
      save?.version === 1 &&
      typeof save.current === 'string' &&
      [save.completed, save.delivered, save.read].every(
        (list) => Array.isArray(list) && list.every((id) => typeof id === 'string'),
      )
    )
      return save as Save
  } catch {
    // Invalid or obsolete saves start a fresh campaign.
  }
}

export type DirectEntry = string | { debug: true; initial?: string }

export function createCampaign(
  scenarios: readonly Scenario[],
  storage?: StorageAccess,
  direct?: DirectEntry,
  replay?: CampaignSnapshot,
) {
  const available = scenarios.filter((item) => item.available)
  const byId = new Map(available.map((item) => [item.id, item]))
  const debugging = typeof direct === 'object' && direct.debug
  const initial = typeof direct === 'object' ? direct.initial : direct
  const inbox = new Map(
    available.flatMap((item) => item.inbox?.messages ?? []).map((item) => [item.id, item]),
  )
  const discovered = new Set<string>()
  const completed = new Set<string>()
  const delivered = new Set<string>()
  const read = new Set<string>()
  const visitedHosts = new Set<string>()
  const readResources = new Set<string>()
  const milestones = new Set<string>()
  const handoffs = new Map<string, Handoff>()
  const dossierReceipts = new Map<string, DossierReceipt>()
  const staleDossier = new Set<string>()
  const levels = new Map<string, LevelSave>()
  let current = ''
  let restoring = true

  function isDirect(id: string) {
    return byId.has(id) && (debugging || initial === id)
  }

  function selectable(id: string) {
    return discovered.has(id) || isDirect(id)
  }

  function start() {
    discovered.clear()
    completed.clear()
    delivered.clear()
    read.clear()
    visitedHosts.clear()
    readResources.clear()
    milestones.clear()
    handoffs.clear()
    dossierReceipts.clear()
    staleDossier.clear()
    levels.clear()
    for (const scenario of available) {
      if (scenario.initiallyDiscovered) discovered.add(scenario.id)
    }
    current = available.find(({ id }) => discovered.has(id))?.id ?? ''
  }

  function snapshot(): CampaignSnapshot {
    return {
      version: 1,
      current,
      completed: [...completed],
      delivered: [...delivered],
      read: [...read],
      visitedHosts: [...visitedHosts],
      readResources: [...readResources],
      ...(milestones.size ? { milestones: [...milestones] } : {}),
      handoffs: Object.fromEntries(handoffs),
      ...(dossierReceipts.size ? { dossierReceipts: Object.fromEntries(dossierReceipts) } : {}),
    }
  }

  function persist() {
    if (restoring || !storage) return
    try {
      storage?.setItem(
        campaignKey,
        JSON.stringify({
          ...snapshot(),
          levels: Object.fromEntries(levels),
        } satisfies Save),
      )
    } catch {
      // The active campaign can continue when storage is unavailable.
    }
  }

  function deliver(id: string) {
    if (!inbox.has(id) || delivered.has(id)) return false
    delivered.add(id)
    return true
  }

  function track(keys: Set<string>, key: string) {
    if (keys.has(key)) return false
    keys.add(key)
    persist()
    return true
  }

  function complete(id: string, handoff?: Handoff, receipt?: DossierReceipt) {
    const scenario = byId.get(id)
    const destinations: Scenario[] = []
    const newMail: string[] = []
    if (scenario?.objective.handoff && handoff?.kind !== scenario.objective.handoff)
      return { destinations, newMail }
    if (
      scenario?.objective.dossier &&
      (!validDossierReceipt(receipt, scenario.dossier!.snapshot, scenario.objective.dossier) ||
        (scenario.dossier?.prior && !dossierReceipts.has(scenario.dossier.prior)))
    )
      return { destinations, newMail }
    if (scenario && !completed.has(id)) {
      completed.add(id)
      if (handoff) handoffs.set(id, handoff)
      if (receipt) dossierReceipts.set(id, receipt)
      staleDossier.delete(id)
      for (const effect of scenario.objective.onComplete) {
        if (effect.type === 'deliverMail') {
          if (!(restoring && effect.liveOnly) && deliver(effect.message))
            newMail.push(effect.message)
        } else {
          const destination = byId.get(effect.scenario)
          if (destination && !discovered.has(destination.id)) {
            discovered.add(destination.id)
            destinations.push(destination)
          }
        }
      }
      persist()
    } else if (scenario && handoff && !handoffs.has(id)) {
      handoffs.set(id, handoff)
      persist()
    }
    return { destinations, newMail }
  }

  function enter(id: string) {
    if (!selectable(id)) return false
    current = id
    for (const message of byId.get(id)?.inbox?.initial ?? []) deliver(message)
    persist()
    return true
  }

  function discardDossier(id: string) {
    const affected = new Set([id])
    for (const scenario of available) {
      if (scenario.dossier?.prior && affected.has(scenario.dossier.prior)) {
        affected.add(scenario.id)
        discovered.delete(scenario.id)
        for (const message of scenario.inbox?.initial ?? []) {
          delivered.delete(message)
          read.delete(message)
        }
      }
      if (!affected.has(scenario.id)) continue
      completed.delete(scenario.id)
      dossierReceipts.delete(scenario.id)
      const level = levels.get(scenario.id)
      if (level)
        levels.set(scenario.id, {
          ...level,
          runtime: { ...level.runtime, dossier: undefined },
          journal: undefined,
          terminal: undefined,
        })
      for (const effect of scenario.objective.onComplete) {
        if (effect.type !== 'deliverMail') continue
        delivered.delete(effect.message)
        read.delete(effect.message)
      }
    }
    staleDossier.add(id)
    if (affected.has(current)) current = id
    persist()
  }

  async function verifyDossier(engine: Engine) {
    for (const scenario of available) {
      const receipt = dossierReceipts.get(scenario.id)
      if (!receipt) continue
      const predecessor = scenario.dossier?.prior
      const result = await engine.runDossier(
        dossierReview(
          scenario,
          receipt,
          predecessor ? dossierReceipts.get(predecessor) : undefined,
        ),
      )
      if (!result.ok && ['engine_unavailable', 'evaluation_failure'].includes(result.error.code))
        throw new Error(result.error.message)
      if (!result.ok || !sameReceipt(result.value.handoff, receipt)) discardDossier(scenario.id)
    }
    enter(current)
  }

  start()
  try {
    const raw = storage?.getItem(campaignKey)
    const saved = decode(replay ? JSON.stringify(replay) : (raw ?? null))
    if (saved) {
      for (const id of saved.delivered) deliver(id)
      for (const scenario of available) {
        const { id, recovery } = scenario
        if (!selectable(id) || !saved.completed.includes(id)) continue
        if (scenario.objective.dossier) {
          complete(id, undefined, saved.dossierReceipts?.[id])
          if (!completed.has(id)) staleDossier.add(id)
          continue
        }
        const handoff = saved.handoffs?.[id]
        if (
          validHandoff(handoff) &&
          recovery &&
          handoff.incident === recovery.dataset.incident &&
          handoff.revision === recovery.dataset.revision
        ) {
          complete(id, restoreRelease(scenario, handoff))
        } else {
          complete(id, restoreRelease(scenario))
        }
      }
      for (const id of saved.read) if (delivered.has(id)) read.add(id)
      for (const [values, keys] of [
        [saved.visitedHosts, visitedHosts],
        [saved.readResources, readResources],
        [saved.milestones, milestones],
      ] as const)
        if (Array.isArray(values))
          for (const value of values) if (typeof value === 'string') keys.add(value)
      if (selectable(saved.current)) current = saved.current
      for (const id of discovered) {
        const level = saved.levels?.[id]
        if (level?.version === 1) levels.set(id, level)
      }
      for (const id of [...staleDossier]) {
        discardDossier(id)
        if (!selectable(saved.current)) current = id
      }
    } else if (!raw) {
      for (const message of byId.get(current)?.inbox?.initial ?? []) deliver(message)
      for (const { id } of available) {
        const key = 'unicodd.objective.' + id
        if (discovered.has(id) && storage?.getItem(key) === 'true') {
          complete(id)
          storage.removeItem(key)
        }
      }
    }
  } catch {
    // Browser storage may be blocked.
  }
  restoring = false
  enter(!replay && initial && selectable(initial) ? initial : current)

  return {
    get current() {
      return current
    },
    get progress(): CampaignProgress {
      return { completed: completed.size, total: available.length }
    },
    get finished() {
      return available.length > 0 && available.every(({ id }) => completed.has(id))
    },
    get hasInbox() {
      return inbox.size > 0
    },
    get delivered() {
      return [...delivered]
    },
    get read() {
      return [...read]
    },
    get visitedHosts() {
      return [...visitedHosts]
    },
    get readResources() {
      return [...readResources]
    },
    message(id: string): MailMessage | undefined {
      return delivered.has(id) ? inbox.get(id) : undefined
    },
    handoffMail(destination: string): string[] {
      return available.flatMap(({ id, objective }) => {
        if (
          !completed.has(id) ||
          !objective.onComplete.some(
            (effect) => effect.type === 'discover' && effect.scenario === destination,
          )
        )
          return []
        return objective.onComplete.flatMap((effect) =>
          effect.type === 'deliverMail' ? [effect.message] : [],
        )
      })
    },
    markRead(id: string) {
      if (delivered.has(id)) track(read, id)
    },
    visitHost: (key: string) => track(visitedHosts, key),
    markResourceRead: (key: string) => track(readResources, key),
    recordMilestone: (key: string) => track(milestones, key),
    deliver(id: string) {
      const added = deliver(id)
      if (added) persist()
      return added
    },
    selectable,
    direct: isDirect,
    handoff: (id: string) => handoffs.get(id),
    dossierReceipt: (id: string) => dossierReceipts.get(id),
    staleDossier: (id: string) => staleDossier.has(id),
    verifyDossier,
    completed: (id: string) => completed.has(id),
    destinations: () => available.filter(({ id }) => selectable(id)),
    enter,
    complete,
    snapshot,
    level: (id: string) => levels.get(id),
    invalidateHistory(revision: string, compatibleRevision?: string) {
      let changed = false
      for (const [id, level] of levels) {
        if (level.revision === revision) continue
        levels.set(
          id,
          compatibleRevision !== undefined && level.revision === compatibleRevision
            ? { ...level, revision }
            : {
                ...level,
                revision,
                journal: undefined,
                terminal: undefined,
                composer: level.composer && {
                  ...level.composer,
                  history: [],
                  index: 0,
                  scratch: undefined,
                },
              },
        )
        changed = true
      }
      if (changed) persist()
    },
    saveLevel(id: string, level: LevelSave) {
      levels.set(id, level)
      persist()
    },
    reset() {
      start()
      enter(current)
      persist()
      return current
    },
  }
}
