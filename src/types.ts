export type Normalization = 'NFC' | 'NFD' | 'NFKC' | 'NFKD'
export const forms: readonly Normalization[] = ['NFC', 'NFD', 'NFKC', 'NFKD']

export type Value =
  | { type: 'text'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'integer'; value: number }

type Operator =
  | 'textEqual'
  | 'concat'
  | 'normalize'
  | 'codePointLength'
  | 'utf16_length'
  | 'utf8_length'
  | 'remove_code_point'
  | 'caseFold'
  | 'skeleton'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'not'
  | 'and'
  | 'or'
  | 'booleanEqual'
  | 'integerEqual'
  | 'integerLessOrEqual'

type Node = { id: string } & (
  | { op: 'input'; input: string }
  | { op: 'literal'; value: Value }
  | { op: 'normalize'; args: [string]; form: Normalization }
  | { op: Exclude<Operator, 'normalize'>; args: string[] }
)

export interface Program {
  version: 1
  inputs: string[]
  nodes: Node[]
  checks: { id: string; node: string; expected: boolean; required?: boolean }[]
}

export interface EngineError {
  code:
    | 'invalid_program'
    | 'invalid_input'
    | 'unsupported_operation'
    | 'type_mismatch'
    | 'evaluation_failure'
    | 'resource_limit'
    | 'engine_unavailable'
  message: string
  path?: string
  offset?: number
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: EngineError }
export interface CheckResult {
  id: string
  actual: boolean
  expected: boolean
  passed: boolean
  required: boolean
}
export interface TraceRecord {
  id: string
  op: string
  dependencies: string[]
  result: Value
}
export interface Evaluation {
  solved: boolean
  checks: CheckResult[]
  trace?: TraceRecord[]
  traceTruncated?: boolean
}
export interface ScalarDetails {
  name?: string
  script: string
  confusables: { scalar: string; script: string }[]
  confusablesTruncated: boolean
  unicodeVersion: string
}

export interface EngineInfo {
  version: number
  unicodeVersion: string
  caseFoldingVersion: string
  skeletonVersion: string
  uts39Revision: number
  recoveryVersion: number
  collationProfile: string
  casingProfile: string
  graphemeVersion: string
  bidiVersion: string
}

export interface Engine {
  info(): Promise<Result<EngineInfo>>
  inspectScalar(text: string): Promise<Result<ScalarDetails>>
  validate(program: unknown): Promise<Result<null>>
  validateRecovery(dataset: unknown): Promise<Result<null>>
  runRecovery(request: RecoveryRequest): Promise<Result<RecoveryReport>>
  evaluate(
    program: Program,
    inputs: Record<string, string>,
    trace?: boolean,
  ): Promise<Result<Evaluation>>
  normalize(text: string, form: Normalization): Promise<Result<string>>
}
import type { RecoveryReport, RecoveryRequest } from './lib/recovery.ts'
