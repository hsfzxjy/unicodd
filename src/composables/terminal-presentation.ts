import { commandEcho } from '../lib/commands'
import type { Entry } from '../lib/workspace'

export interface TerminalEntryView extends Entry {
  arrival?: { host: string; role: string }
}

export function displayedCommand(entry: Entry) {
  const raw = entry.echo ?? ''
  const value = commandEcho(entry.localScope ? raw.replace(/^\s*local\s+/u, '') : raw)
  if (value.length <= 512) return value
  const limit =
    /[\uD800-\uDBFF]/u.test(value[511]) && /[\uDC00-\uDFFF]/u.test(value[512]) ? 511 : 512
  return value.slice(0, limit) + '…'
}
