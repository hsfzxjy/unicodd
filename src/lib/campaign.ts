import type { MailMessage, Scenario } from './scenario.ts'

export const campaignKey = 'unicodd.campaign'
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

interface Save {
  version: 1
  current: string
  completed: string[]
  delivered: string[]
  read: string[]
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
    for (const scenario of available) {
      if (scenario.initiallyDiscovered) discovered.add(scenario.id)
    }
    current = available.find(({ id }) => discovered.has(id))?.id ?? ''
  }

  function persist() {
    if (restoring) return
    try {
      storage?.setItem(
        campaignKey,
        JSON.stringify({
          version: 1,
          current,
          completed: [...completed],
          delivered: [...delivered],
          read: [...read],
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

  function complete(id: string) {
    const scenario = byId.get(id)
    const destinations: Scenario[] = []
    let newMail = false
    if (scenario && !completed.has(id)) {
      completed.add(id)
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
    const saved = decode(raw ?? null)
    if (saved) {
      for (const id of saved.delivered) deliver(id)
      for (const id of saved.completed) {
        if (discovered.has(id)) complete(id)
      }
      for (const id of saved.read) if (delivered.has(id)) read.add(id)
      if (selectable(saved.current)) current = saved.current
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
    message(id: string): MailMessage | undefined {
      return delivered.has(id) ? inbox.get(id) : undefined
    },
    markRead(id: string) {
      if (delivered.has(id) && !read.has(id)) {
        read.add(id)
        persist()
      }
    },
    deliver(id: string) {
      const added = deliver(id)
      if (added) persist()
      return added
    },
    selectable,
    completed: (id: string) => completed.has(id),
    destinations: () => available.filter(({ id }) => selectable(id)),
    enter,
    complete,
    reset() {
      start()
      enter(current)
      persist()
      return current
    },
  }
}
