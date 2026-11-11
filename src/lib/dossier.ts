import type { RecoveryRow } from './recovery.ts'

export const dossierArity = {
  search: 3,
  tokens: 3,
  select: 0,
  source: 2,
  'map-span': 3,
  'json-check': 1,
  redact: 3,
  surfaces: 1,
  audit: 0,
} as const
export type DossierCommand = keyof typeof dossierArity

export const dossierStages = { selection: 'select', publication: 'audit' } as const
export const dossierPredecessor: Partial<Record<DossierStage, DossierStage>> = {
  publication: 'selection',
}
export type DossierStage = keyof typeof dossierStages

export function isDossierCommand(command: string): command is DossierCommand {
  return Object.hasOwn(dossierArity, command)
}

export interface DossierReceipt {
  version: 1
  snapshot: string
  selection: string[]
  digest: string
  publication?: { args: string[]; digest: string }
}

export function validDossierReceipt(
  receipt: DossierReceipt | undefined,
  snapshot: string,
  stage: DossierStage,
): receipt is DossierReceipt {
  return (
    receipt?.version === 1 &&
    receipt.snapshot === snapshot &&
    validDigest(receipt.digest) &&
    validArguments(receipt.selection, 3) &&
    (stage === 'selection'
      ? receipt.publication === undefined
      : validDigest(receipt.publication?.digest) && validArguments(receipt.publication?.args, 3))
  )
}

function validDigest(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
}

export function receiptArgs(receipt: DossierReceipt, stage: DossierStage) {
  return stage === 'selection' ? receipt.selection : receipt.publication!.args
}

export function sameReceipt(checked: DossierReceipt | null, stored: DossierReceipt) {
  return (
    checked?.snapshot === stored.snapshot &&
    checked?.digest === stored.digest &&
    checked.publication?.digest === stored.publication?.digest
  )
}

export function stagesDossierCandidate(command: DossierCommand) {
  return command === 'search' || command === 'redact'
}

export function validArguments(value: unknown, count: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length === count &&
    value.every((item) => typeof item === 'string' && item.length <= 2048)
  )
}

export interface DossierRequest {
  version: 1
  dataset: unknown
  command: DossierCommand
  args: string[]
  candidate?: string[]
  prior?: DossierReceipt
}

export interface DossierReport {
  solved: boolean
  checks: { id: string; passed: boolean }[]
  declaredChecks: string[]
  rows: RecoveryRow[]
  candidate: string[] | null
  handoff: DossierReceipt | null
}
