import type { MailMessage, Scenario } from './scenario.ts'
import type { Handoff } from './recovery.ts'
import type { LevelSave } from './workspace.ts'

export const campaignKey = 'unicodd.campaign'
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface CampaignSnapshot {
  version: 1
  current: string
  completed: string[]
  delivered: string[]
  read: string[]
  visitedHosts?: string[]
  readResources?: string[]
  handoffs?: Record<string, Handoff>
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
  switch (handoff.kind) {
    case 'appeals':
      return Array.isArray(handoff.records) && handoff.records.every(text)
    case 'approvals':
      return Array.isArray(handoff.approvals) && handoff.approvals.every(approval)
    case 'release':
      return (
        Array.isArray(handoff.identities) &&
        handoff.identities.every(
          (entry) => entry && text(entry.canonical) && text(entry.name) && approval(entry.approval),
        )
      )
    default:
      return false
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

export function createCampaign(
  scenarios: readonly Scenario[],
  storage?: StorageAccess,
  direct?: string,
  replay?: CampaignSnapshot,
) {
  const available = scenarios.filter((item) => item.available)
  const byId = new Map(available.map((item) => [item.id, item]))
  const inbox = new Map(
    available.flatMap((item) => item.inbox?.messages ?? []).map((item) => [item.id, item]),
  )
  const discovered = new Set<string>()
  const completed = new Set<string>()
  const delivered = new Set<string>()
  const read = new Set<string>()
  const visitedHosts = new Set<string>()
  const readResources = new Set<string>()
  const handoffs = new Map<string, Handoff>()
  const levels = new Map<string, LevelSave>()
  let current = ''
  let restoring = true

  function selectable(id: string) {
    return discovered.has(id) || (direct === id && byId.has(id))
  }

  function start() {
    discovered.clear()
    completed.clear()
    delivered.clear()
    read.clear()
    visitedHosts.clear()
    readResources.clear()
    handoffs.clear()
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
      handoffs: Object.fromEntries(handoffs),
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

  function complete(id: string, handoff?: Handoff) {
    const scenario = byId.get(id)
    const destinations: Scenario[] = []
    let newMail = false
    if (scenario && !completed.has(id)) {
      completed.add(id)
      if (handoff) handoffs.set(id, handoff)
      for (const effect of scenario.objective.onComplete) {
        if (effect.type === 'deliverMail') {
          if (deliver(effect.message)) newMail = true
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

  start()
  try {
    const raw = storage?.getItem(campaignKey)
    const saved = decode(replay ? JSON.stringify(replay) : (raw ?? null))
    if (saved) {
      for (const id of saved.delivered) deliver(id)
      for (const { id, recovery } of available) {
        if (!discovered.has(id) || !saved.completed.includes(id)) continue
        const handoff = saved.handoffs?.[id]
        if (
          validHandoff(handoff) &&
          recovery &&
          handoff.incident === recovery.dataset.incident &&
          handoff.revision === recovery.dataset.revision
        ) {
          complete(id, handoff)
        } else {
          complete(id)
        }
      }
      for (const id of saved.read) if (delivered.has(id)) read.add(id)
      for (const [values, keys] of [
        [saved.visitedHosts, visitedHosts],
        [saved.readResources, readResources],
      ] as const)
        if (Array.isArray(values))
          for (const value of values) if (typeof value === 'string') keys.add(value)
      if (selectable(saved.current)) current = saved.current
      for (const id of discovered) {
        const level = saved.levels?.[id]
        if (level?.version === 1) levels.set(id, level)
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
  enter(direct && selectable(direct) ? direct : current)

  return {
    get current() {
      return current
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
    markRead(id: string) {
      if (delivered.has(id)) track(read, id)
    },
    visitHost: (key: string) => track(visitedHosts, key),
    markResourceRead: (key: string) => track(readResources, key),
    deliver(id: string) {
      const added = deliver(id)
      if (added) persist()
      return added
    },
    selectable,
    direct: (id: string) => direct === id,
    handoff: (id: string) => handoffs.get(id),
    completed: (id: string) => completed.has(id),
    destinations: () => available.filter(({ id }) => selectable(id)),
    enter,
    complete,
    snapshot,
    level: (id: string) => levels.get(id),
    invalidateHistory(revision: string) {
      let changed = false
      for (const [id, level] of levels) {
        if (level.revision === revision) continue
        levels.set(id, {
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
        })
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
