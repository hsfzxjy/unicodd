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
} as const

export type RecoveryCommand = keyof typeof recoveryArity

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
}

export type RecoveryContext = Readonly<Record<string, unknown>>

interface Approval {
  registration: string
  owner: string
  receipt: string
}

export type Handoff = {
  version: 1
  incident: string
  revision: string
} & (
  | { kind: 'appeals'; records: string[] }
  | { kind: 'approvals'; approvals: Approval[] }
  | { kind: 'release'; identities: { canonical: string; name: string; approval: Approval }[] }
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
  inspect?: string[]
  audit?: boolean
}

export interface RecoveryReport {
  solved: boolean
  checks: { id: string; actual: boolean; expected: boolean; passed: boolean }[]
  declaredChecks: string[]
  rows: RecoveryRow[]
  context: RecoveryContext
  handoff?: Handoff
}
