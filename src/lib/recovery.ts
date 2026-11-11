export const recoveryArity = {
  collate: 4,
  replay: 5,
  recover: 2,
  casing: 2,
  lookup: 2,
  probe: 1,
  bind: 3,
  prepare: 2,
  preview: 4,
  verify: 0,
  commit: 0,
  resolve: 3,
  dispatch: 3,
  capture: 2,
  deframe: 5,
  identifier: 2,
  mirror: 3,
} as const

export type RecoveryCommand = keyof typeof recoveryArity

export const archiveStages = {
  dispatch: 'dispatch',
  ingestion: 'deframe',
  mirror: 'mirror',
} as const
export type ArchiveStage = keyof typeof archiveStages

export interface Registration {
  id: string
  owner: string
  name: string
  verified: boolean
}

// The complete dataset and evaluator context are validated and interpreted by Rust.
export interface RecoveryDataset {
  incident: string
  revision: string
  registrations: Registration[]
  receipts: {
    id: string
    registration: string
    owner: string
    verified: boolean
    diagnostic: boolean
  }[]
  archive?: { sources: OutboxReceipt[] }
}

export type RecoveryContext = Readonly<Record<string, unknown>>

interface Approval {
  registration: string
  owner: string
  receipt: string
}

interface OutboxReceipt {
  id: string
  registration: string
  owner: string
  archiveId: string
  payload: string
  digest: string
  endpoint: string
  path: string
  status: 'QUEUED'
  ackMarker: string
  ackDigest: string
}

interface RestoredIdentity {
  canonical: string
  name: string
  approval: Approval
}

interface DispatchEvidence {
  release: { identities: RestoredIdentity[]; outbox: OutboxReceipt[] }
  routes: { receipt: string; endpoint: string; host: string; path: string; status: number }[]
  capture: number[]
  captureDigest: string
}

interface IngestionEvidence {
  dispatch: DispatchEvidence
  frames: {
    offset: number
    payload: number[]
    digest: string
    disposition:
      | { kind: 'heartbeat' }
      | { kind: 'quarantined'; offset: number; length: number }
      | {
          kind: 'accepted'
          receipt: string
          registration: string
          owner: string
          sourceDigest: string
        }
  }[]
}

interface MirrorEvidence {
  ingestion: IngestionEvidence
  records: {
    id: string
    registration: string
    owner: string
    rawLabel: string
    displayLabel: string
    rawDigest: string
    sourceDigest: string
    handle: string
    searchLegacy: string
    searchModern: string
  }[]
  searchVersion: string
  legacyReferences: Record<string, string>
  legacySearch: Record<string, string[]>
  modernSearch: Record<string, string[]>
}

export type Handoff = {
  version: 1
  incident: string
  revision: string
} & (
  | { kind: 'appeals'; records: string[] }
  | { kind: 'approvals'; approvals: Approval[] }
  | { kind: 'release'; identities: RestoredIdentity[]; outbox?: OutboxReceipt[] }
  | { kind: 'dispatch'; evidence: DispatchEvidence }
  | { kind: 'ingestion'; evidence: IngestionEvidence }
  | { kind: 'mirror'; evidence: MirrorEvidence }
)

export interface RecoveryRequest {
  version: 1
  dataset: RecoveryDataset
  command: RecoveryCommand
  args: string[]
  context?: RecoveryContext
  prior?: Handoff
  committed?: Handoff
  direct?: boolean
}

export interface RecoveryRow {
  label: string
  fields: string[]
  details?: string[]
  serialized?: string
  copyLabel?: string
  source?: {
    before: string
    hit: string
    after: string
    coordinates: {
      utf8: [number, number]
      utf16: [number, number]
      scalars: [number, number]
      graphemes: [number, number]
      exactGraphemes: boolean
    }
  }
  inspect?: string[]
  audit?: boolean
  hex?: { offset: number; bytes: number[]; chunkStart: boolean; highlight?: [number, number] }
}

export interface RecoveryReport {
  solved: boolean
  checks: { id: string; actual: boolean; expected: boolean; passed: boolean }[]
  declaredChecks: string[]
  rows: RecoveryRow[]
  context: RecoveryContext
  handoff?: Handoff
}

export function archiveRows(handoff: Handoff): RecoveryRow[] {
  switch (handoff.kind) {
    case 'dispatch':
      return handoff.evidence.routes.map(({ receipt, endpoint, host, path }) => ({
        label: receipt,
        fields: [endpoint, host, path],
      }))
    case 'ingestion':
      return handoff.evidence.frames.flatMap(({ offset, digest, disposition }) =>
        disposition.kind === 'accepted'
          ? [{ label: disposition.receipt, fields: [disposition.registration, digest] }]
          : disposition.kind === 'quarantined'
            ? [{ label: 'Quarantined frame', fields: [String(offset), digest] }]
            : [],
      )
    case 'mirror':
      return handoff.evidence.records.map(({ id, handle, displayLabel, owner }) => ({
        label: id,
        fields: [handle, displayLabel, owner],
      }))
    default:
      return []
  }
}
