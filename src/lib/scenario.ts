import type { Program } from '../types.ts'

export interface Identity {
  user: string
  role: string
}

export interface Guard {
  roles?: string[]
  flag?: string
}

export type Effect =
  | { type: 'session'; identity: Identity }
  | { type: 'flag'; flag: string }
  | { type: 'message'; text: string }

interface ResourceBase {
  id: string
  path: string
  discover?: Guard
  access?: Guard
  denied?: string
}

export type Resource = ResourceBase &
  ({ type: 'directory' } | { type: 'file'; text: string; inspectLines: number[]; onRead: Effect[] })

export interface Login {
  label: string
  input: string
  initial: string
  program: Program
  access?: Guard
  success: Effect[]
  failure: string
  rejected: { check: string; message: string }[]
}

export interface Host {
  id: string
  name: string
  guest: Identity
  welcome: string
  discover?: string
  resources: Resource[]
  login?: Login
}

export interface Scenario {
  id: string
  title: string
  introduction: string
  roles: string[]
  flags: string[]
  local: Identity
  initialHost?: string
  hosts: Host[]
  objective: { text: string; read: string; message: string }
}

export function parentPath(path: string): string {
  return path.slice(0, path.lastIndexOf('/')) || '/'
}
