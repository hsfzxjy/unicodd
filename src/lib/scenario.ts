import type { Program } from '../types.ts'
import type { RecoveryCommand, RecoveryDataset } from './recovery.ts'

export interface Identity {
  user: string
  role: string
}

export interface Guard {
  roles?: string[]
  flag?: string
}

export const puzzleArity = { login: 1, route: 2, reconcile: 1, reconstruct: 2 } as const
export type PuzzleCommand = keyof typeof puzzleArity

export interface PuzzleField {
  input: string
  label: string
  initial: string
  fixed?: string
  kind?: 'text' | 'payload'
}

export type ProgressEffect =
  { type: 'discover'; scenario: string } | { type: 'deliverMail'; message: string }

export type Effect =
  | { type: 'session'; identity: Identity }
  | { type: 'flag'; flag: string }
  | { type: 'clearFlag'; flag: string }
  | { type: 'message'; text: string }
  | { type: 'deliverMail'; message: string }
  | { type: 'resourceLink'; resource: string }

export interface MailMessage {
  id: string
  from: string
  to: string
  subject: string
  date?: string
  body: string
}

interface ResourceBase {
  id: string
  path: string
  discover?: Guard
  access?: Guard
  denied?: string
}

export type Resource = ResourceBase &
  (
    | { type: 'directory' }
    | ({ onRead: Effect[] } & (
        | { type: 'file'; text: string; inspectLines: number[]; inspectNotation: boolean }
        | { type: 'mail'; messages: MailMessage[] }
      ))
  )

export interface PuzzleBinding {
  command: PuzzleCommand
  actionLabel: string
  submitLabel: string
  label: string
  fields: PuzzleField[]
  program: Program
  access?: Guard
  success: Effect[]
  failure: string
  rejected: { check: string; message: string; stage?: string }[]
}

export interface RecoveryBinding extends Omit<PuzzleBinding, 'command' | 'program'> {
  command: RecoveryCommand
  quick: boolean
  invalidates: string[]
}

export type OperationBinding = PuzzleBinding | RecoveryBinding
export type OperationCommand = OperationBinding['command']

export interface Host {
  id: string
  name: string
  guest: Identity
  welcome: string
  discover?: string
  resources: Resource[]
  operations: PuzzleBinding[]
  recovery?: RecoveryBinding[]
  status: { label: string; value: string; after?: { flag: string; value: string } }[]
}

export interface Scenario {
  id: string
  title: string
  available: boolean
  initiallyDiscovered: boolean
  introduction: string
  roles: string[]
  flags: string[]
  local: Identity
  initialHost?: string
  hosts: Host[]
  inbox?: { messages: MailMessage[]; initial: string[] }
  recovery?: { path: string; dataset: RecoveryDataset; source: string; prior?: string }
  objective: ({ read: string; action?: never } | { read?: never; action: RecoveryCommand }) & {
    text: string
    message: string
    onComplete: ProgressEffect[]
  }
}

export function parentPath(path: string): string {
  return path.slice(0, path.lastIndexOf('/')) || '/'
}
