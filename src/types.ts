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
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'not'
  | 'and'
  | 'or'
  | 'booleanEqual'
  | 'integerEqual'

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

export interface Narrative {
  title: string
  system: string
  description: string
  objective: string
  introduction: string[]
  inputs: Record<string, string>
  checks: Record<string, { label: string; detail: string }>
  hints?: string[]
  feedback: { failed: string; passed: string }
  recovered?: string
  nextTarget?: string
}

export interface Target {
  id: string
  program: Program
  initialInputs: Record<string, string>
  narrative: Narrative
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
export interface Engine {
  info(): Promise<Result<{ version: number; unicodeVersion: string }>>
  validate(program: unknown): Promise<Result<null>>
  evaluate(
    program: Program,
    inputs: Record<string, string>,
    trace?: boolean,
  ): Promise<Result<Evaluation>>
  normalize(text: string, form: Normalization): Promise<Result<string>>
}
