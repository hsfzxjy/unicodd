import { createCampaign, type CampaignSnapshot, type DirectEntry } from './campaign.ts'
import { actionCommand, commandDefinition, commandInsertion, type CommandName } from './commands.ts'
import { createRuntime, type Action, type Output, type RuntimeSnapshot } from './runtime.ts'
import type { Scenario } from './scenario.ts'
import { decodeUnicodeEscapes, type Span } from './unicode.ts'
import type { Engine } from '../types.ts'
import type { ArgumentInspector } from './argument-inspectors.ts'

export interface Draft {
  name?: CommandName
  text: string
  values: string[]
  active: number
  spans: Span[]
  selection?: Span
  tools?: ArgumentView[]
}

export interface ArgumentView {
  expanded: boolean
  page: number
  bytes?: boolean
  inspector?: ArgumentInspector
}

export interface ComposerSave {
  draft: Draft
  drafts: Draft[]
  history: Draft[]
  index: number
  scratch?: Draft
}

function validDraft(draft: Draft | undefined): draft is Draft {
  const span = (value?: Span) =>
    value &&
    Number.isSafeInteger(value.start) &&
    Number.isSafeInteger(value.end) &&
    value.start >= 0 &&
    value.end >= value.start
  return Boolean(
    draft &&
    typeof draft.text === 'string' &&
    (draft.name === undefined || commandDefinition(draft.name)) &&
    Array.isArray(draft.values) &&
    draft.values.every((value) => typeof value === 'string') &&
    Array.isArray(draft.spans) &&
    draft.spans.every(span) &&
    Number.isSafeInteger(draft.active) &&
    draft.active >= 0 &&
    (draft.selection === undefined || span(draft.selection)),
  )
}

export function restoreComposerDraft(
  draft?: Draft | (Omit<Draft, 'name'> & { name: 'local' }),
): Draft | undefined {
  if (draft?.name !== 'local') return validDraft(draft) ? draft : undefined
  const previous = { ...draft, name: undefined }
  if (!validDraft(previous)) return
  const [subcommand = '', argument] = previous.values
  const decoded = decodeUnicodeEscapes(subcommand)
  const command = 'text' in decoded && commandDefinition(`local ${decoded.text}`)
  if (command && (command.arguments.length || !argument)) {
    return {
      ...previous,
      name: command.name,
      values: previous.values.slice(1, 1 + command.arguments.length),
      active: 0,
      spans: previous.spans.slice(1),
      tools: Array.isArray(previous.tools) ? previous.tools.slice(1) : undefined,
    }
  }
  // Keep unfinished legacy subcommands editable in the single-line prompt.
  return {
    text: ['local', ...previous.values].join(' ').replace(/[\r\n]/gu, commandInsertion),
    values: [],
    active: 0,
    spans: [],
  }
}

export interface TerminalView {
  collapsed: number[]
  scrollTop: number
  following: boolean
}

export interface Checkpoint {
  runtime: RuntimeSnapshot
  campaign: CampaignSnapshot
}

export interface CommandRecord {
  id: number
  action: Action | { type: 'clipboard'; ok: boolean }
  echo?: string
  checkpoint?: Checkpoint
  transientOutput?: Output[]
}

export interface Journal {
  start: Checkpoint
  welcome: boolean
  commands: CommandRecord[]
}

export type TerminalPanel = 'goal' | 'session' | 'progress'

export interface LevelSave {
  version: 1
  revision: string
  runtime: RuntimeSnapshot
  composer?: ComposerSave
  journal?: Journal
  terminal?: TerminalView
  sessionExpanded: boolean
  sessionPanel?: TerminalPanel
}

export interface Entry {
  id: number
  echo?: string
  prompt?: string
  connected?: boolean
  localScope?: boolean
  output: Output[]
  waiting?: boolean
  freshProgress?: boolean
}

export function entryContext(action: CommandRecord['action'], host?: string) {
  const localScope = 'scope' in action && action.scope === 'local'
  return {
    prompt: localScope ? 'local' : (host ?? 'local'),
    connected: Boolean(host) && !localScope,
    localScope,
  }
}

export interface JournalFrame {
  record: CommandRecord
  before: Checkpoint
}

export const scrollbackLimit = 80

// These catalog revisions clarify the token reference. Their journal actions replay
// with the same effects on secure and plain-HTTP origins.
const compatibleContent: Readonly<Record<string, string>> = {
  '98e4d6b2b9b0a6180001e7c72e2d41297d59aacc443b7aed72ade234e79add84':
    '5b28d0898ad5e51ad67d9f1cd7823aa87dce7994e20cb7f596f2e03cf24e3d67',
  'fnv64:b27adbbeb2ede282': 'fnv64:78951a9d6c3c3fd1',
  b950a5e7fe990a5f7c38a5664f6bb004f9099cc6a63bf86f815288df0894be8b:
    '5b28d0898ad5e51ad67d9f1cd7823aa87dce7994e20cb7f596f2e03cf24e3d67',
  'fnv64:d27bc6d284ff2773': 'fnv64:78951a9d6c3c3fd1',
}

export async function historyRevision(logic: string, content: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(content))
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    const key = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return logic + ':' + (compatibleContent[key] ?? key)
  }
  // Web Crypto is unavailable on plain HTTP development origins.
  let hash = 0xcbf29ce484222325n
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n)
  const key = 'fnv64:' + hash.toString(16)
  return logic + ':' + (compatibleContent[key] ?? key)
}

export async function replayJournal(
  journal: Journal,
  scenario: Scenario,
  scenarios: readonly Scenario[],
  engine: Engine,
  direct?: DirectEntry,
) {
  function open(checkpoint: Checkpoint) {
    if (!checkpoint?.runtime || !checkpoint.campaign) throw new Error('Invalid checkpoint')
    const campaign = createCampaign(scenarios, undefined, direct, checkpoint.campaign)
    return { campaign, runtime: createRuntime(scenario, engine, campaign, checkpoint.runtime) }
  }

  let { campaign, runtime } = open(journal.start)
  const entries: Entry[] = journal.welcome ? [{ id: 0, output: runtime.welcome() }] : []
  const frames: JournalFrame[] = []
  let lastId = 0
  for (const record of journal.commands.slice(-(scrollbackLimit - entries.length))) {
    if (
      !Number.isSafeInteger(record.id) ||
      record.id <= lastId ||
      (record.echo !== undefined && typeof record.echo !== 'string')
    )
      throw new Error('Invalid command record')
    lastId = record.id
    if (record.checkpoint) ({ campaign, runtime } = open(record.checkpoint))
    const before = { runtime: runtime.snapshot(), campaign: campaign.snapshot() }
    const { action } = record
    const output =
      record.transientOutput ??
      (action.type === 'clipboard'
        ? ([
            {
              kind: action.ok ? 'message' : 'error',
              text: action.ok ? 'Copied.' : 'Clipboard unavailable.',
            },
          ] as Output[])
        : ((await runtime.dispatch(action)).output ?? []))
    entries.push({
      id: record.id,
      echo: record.echo ?? (action.type === 'clipboard' ? undefined : actionCommand(action)),
      ...entryContext(action, before.runtime.host),
      output,
    })
    frames.push({ record, before })
  }
  return { entries, frames }
}
