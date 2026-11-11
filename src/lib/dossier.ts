import type { RecoveryRow } from './recovery.ts'
import type { Scenario } from './scenario.ts'

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
  targets: 0,
  'probe-path': 3,
  assets: 1,
  extract: 2,
  roundtrip: 0,
} as const
export type DossierCommand = keyof typeof dossierArity

export const dossierStages = {
  selection: 'select',
  publication: 'audit',
  bundle: 'roundtrip',
} as const
export const dossierCandidates = {
  selection: 'search',
  publication: 'redact',
  bundle: 'extract',
} as const
export const dossierPredecessor: Partial<Record<DossierStage, DossierStage>> = {
  publication: 'selection',
  bundle: 'publication',
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
  bundle?: { args: string[]; digest: string }
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
      : validDigest(receipt.publication?.digest) &&
        validArguments(receipt.publication?.args, dossierArity.redact)) &&
    (stage === 'bundle'
      ? validDigest(receipt.bundle?.digest) &&
        validArguments(receipt.bundle?.args, dossierArity.extract)
      : receipt.bundle === undefined)
  )
}

function validDigest(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
}

export function dossierReview(
  scenario: Scenario,
  receipt: DossierReceipt,
  prior?: DossierReceipt,
): DossierRequest {
  const stage = scenario.objective.dossier!
  return {
    version: 1,
    dataset: scenario.dossier!.dataset,
    command: dossierStages[stage],
    args: [],
    candidate: stage === 'selection' ? receipt.selection : receipt[stage]!.args,
    prior,
  }
}

export function sameReceipt(checked: DossierReceipt | null, stored: DossierReceipt) {
  const sameArgs = (left?: string[], right?: string[]) =>
    JSON.stringify(left) === JSON.stringify(right)
  return (
    checked?.version === stored.version &&
    checked?.snapshot === stored.snapshot &&
    checked?.digest === stored.digest &&
    sameArgs(checked.selection, stored.selection) &&
    checked.publication?.digest === stored.publication?.digest &&
    sameArgs(checked.publication?.args, stored.publication?.args) &&
    checked.bundle?.digest === stored.bundle?.digest &&
    sameArgs(checked.bundle?.args, stored.bundle?.args)
  )
}

export function stagesDossierCandidate(command: DossierCommand) {
  return Object.values(dossierCandidates).some((candidate) => candidate === command)
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
