import type { Entry } from '../lib/workspace'

export interface TerminalEntryView extends Entry {
  arrival?: { host: string; role: string }
}
