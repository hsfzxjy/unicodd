import type { RecoveryRow } from './recovery.ts'

export const dossierArity = { search: 3, tokens: 3, select: 0 } as const
export type DossierCommand = keyof typeof dossierArity

export const dossierStages = { selection: 'select' } as const
export type DossierStage = keyof typeof dossierStages

export function isDossierCommand(command: string): command is DossierCommand {
  return Object.hasOwn(dossierArity, command)
}

export interface DossierReceipt {
  version: 1
  snapshot: string
  selection: string[]
  digest: string
}

export function validDossierReceipt(receipt: DossierReceipt | undefined, snapshot: string) {
  return (
    receipt?.version === 1 &&
    receipt.snapshot === snapshot &&
    typeof receipt.digest === 'string' &&
    /^[0-9a-f]{64}$/u.test(receipt.digest) &&
    validArguments(receipt.selection, 3)
  )
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
}

export interface DossierReport {
  solved: boolean
  checks: { id: string; passed: boolean }[]
  declaredChecks: string[]
  rows: RecoveryRow[]
  candidate: string[] | null
  handoff: DossierReceipt | null
}
