import type { Engine, EngineError, Program } from '../types.ts'
import {
  parentPath,
  type Effect,
  type Guard,
  type Host,
  type Identity,
  type PuzzleBinding,
  type PuzzleCommand,
  type ProgressEffect,
  type MailMessage,
  type Resource,
  type Scenario,
} from './scenario.ts'
import { invalidNotation, unpairedSurrogate } from './unicode.ts'

export interface ScenarioEntry {
  id: string
  label: string
  scenario: string
  available: boolean
  initiallyDiscovered: boolean
}

const identifier = /^[a-zA-Z0-9_-]{1,64}$/
const assetPath = /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/
const virtualPath = /^\/(?:[^/\\\u0000-\u001f\u007f]+\/)*[^/\\\u0000-\u001f\u007f]+$/u

function invalid(file: string, field: string, message: string): never {
  throw new Error(`${file}${field ? ` · ${field}` : ''} — ${message}`)
}

class Field {
  readonly value: unknown
  readonly file: string
  readonly path: string

  constructor(value: unknown, file: string, path = '$') {
    this.value = value
    this.file = file
    this.path = path
  }

  fail(message: string): never {
    return invalid(this.file, this.path, message)
  }

  object(...keys: string[]) {
    if (typeof this.value !== 'object' || this.value === null || Array.isArray(this.value)) {
      return this.fail('Expected an object.')
    }
    const data = this.value as Record<string, unknown>
    for (const key of Object.keys(data)) {
      if (!keys.includes(key)) this.at(key, data[key]).fail('Unknown field.')
    }
    return (key: string) => this.at(key, Object.hasOwn(data, key) ? data[key] : undefined)
  }

  at(key: string, value: unknown) {
    return new Field(value, this.file, this.path === '$' ? key : `${this.path}.${key}`)
  }

  list<T>(read: (field: Field) => T): T[] {
    if (!Array.isArray(this.value)) return this.fail('Expected an array.')
    return this.value.map((item: unknown, index) =>
      read(new Field(item, this.file, `${this.path}[${index}]`)),
    )
  }

  optional<T>(read: (field: Field) => T): T | undefined {
    return this.value === undefined ? undefined : read(this)
  }

  text(allowEmpty = false): string {
    if (typeof this.value !== 'string' || (!allowEmpty && !this.value.trim()))
      return this.fail(allowEmpty ? 'Expected text.' : 'Expected nonempty text.')
    const offset = unpairedSurrogate(this.value)
    if (offset !== undefined) this.fail(`Unpaired surrogate at UTF-16 offset ${offset}.`)
    return this.value
  }

  id(): string {
    const id = this.text()
    return identifier.test(id) ? id : this.fail('Invalid ID.')
  }

  unique(seen: Set<string>, value = this.id()): string {
    if (seen.has(value)) this.fail(`Duplicate value "${value}".`)
    seen.add(value)
    return value
  }

  ref<T extends string>(values: readonly T[], kind: string): T {
    const value = this.text()
    return values.includes(value as T) ? (value as T) : this.fail(`Unknown ${kind} "${value}".`)
  }

  asset(json = false): string {
    const path = this.text()
    if (!assetPath.test(path) || (json && !path.endsWith('.json')))
      this.fail('Expected a relative asset path within the content directory.')
    return path
  }

  bool(): boolean {
    return typeof this.value === 'boolean' ? this.value : this.fail('Expected true or false.')
  }

  version() {
    if (this.value !== 1) this.fail('Unsupported schema version. Expected 1.')
  }
}

export function createContentLoader(
  read: (path: string) => Promise<ArrayBuffer | Uint8Array>,
  engine: Engine,
) {
  async function text(file: string): Promise<string> {
    let bytes: ArrayBuffer | Uint8Array
    try {
      bytes = await read(file)
    } catch (error) {
      invalid(file, '', error instanceof Error ? error.message : 'Could not read content.')
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return invalid(file, '', 'Invalid UTF-8.')
    }
  }

  async function json(file: string): Promise<Field> {
    const body = await text(file)
    try {
      return new Field(JSON.parse(body) as unknown, file)
    } catch {
      return invalid(file, '', 'Invalid JSON.')
    }
  }

  async function mailMessages(file: string): Promise<MailMessage[]> {
    const field = (await json(file)).object('messages')('messages')
    const seen = new Set<string>()
    let bodyLength = 0
    function header(field: Field) {
      const text = field.text()
      if (text.length > 200 || /[\u0000-\u001f\u007f]/u.test(text))
        field.fail('Expected a single-line mail header of at most 200 UTF-16 units.')
      return text
    }
    const messages = field.list((item) => {
      const get = item.object('id', 'from', 'to', 'subject', 'date', 'body')
      const id = get('id').unique(seen)
      const body = get('body').text()
      bodyLength += body.length
      if (bodyLength > 32_768) get('body').fail('Mail bodies exceed 32,768 UTF-16 units per asset.')
      return {
        id,
        from: header(get('from')),
        to: header(get('to')),
        subject: header(get('subject')),
        date: get('date').optional(header),
        body,
      }
    })
    if (!messages.length || messages.length > 32) field.fail('Expected 1 to 32 mail messages.')
    return messages
  }

  function engineFailure(file: string, error: EngineError): never {
    return invalid(file, error.path ?? '', `${error.code} · ${error.message}`)
  }

  const loader = {
    async manifest(): Promise<ScenarioEntry[]> {
      const get = (await json('manifest.json')).object('version', 'scenarios')
      get('version').version()
      const seen = new Set<string>()
      return get('scenarios').list((field) => {
        const entry = field.object('id', 'label', 'scenario', 'available', 'initiallyDiscovered')
        return {
          id: entry('id').unique(seen),
          label: entry('label').text(),
          scenario: entry('scenario').asset(true),
          available: entry('available').optional((item) => item.bool()) ?? true,
          initiallyDiscovered: entry('initiallyDiscovered').optional((item) => item.bool()) ?? true,
        }
      })
    },

    async scenario(entry: ScenarioEntry): Promise<Scenario> {
      const file = entry.scenario
      const folder = file.slice(0, file.lastIndexOf('/') + 1)
      const root = await json(file)
      const get = root.object(
        'version',
        'title',
        'introduction',
        'roles',
        'flags',
        'local',
        'initialHost',
        'hosts',
        'objective',
        'inbox',
      )
      get('version').version()
      const ids = (field: Field) => {
        const seen = new Set<string>()
        return field.list((item) => item.unique(seen))
      }
      const roles = ids(get('roles'))
      const flags = ids(get('flags'))
      const inbox = await get('inbox').optional(async (field) => {
        const get = field.object('content', 'initial')
        const messages = await mailMessages(folder + get('content').asset(true))
        const messageIds = messages.map(({ id }) => id)
        const seen = new Set<string>()
        const initial = get('initial').list((item) =>
          item.unique(seen, item.ref(messageIds, 'inbox message')),
        )
        return { messages, initial }
      })
      const inboxIds = inbox?.messages.map(({ id }) => id) ?? []

      function identity(field: Field): Identity {
        const get = field.object('user', 'role')
        return { user: get('user').text(), role: get('role').ref(roles, 'role') }
      }

      function guard(field: Field): Guard {
        const get = field.object('roles', 'flag')
        return {
          roles: get('roles').optional((item) => item.list((role) => role.ref(roles, 'role'))),
          flag: get('flag').optional((item) => item.ref(flags, 'flag')),
        }
      }

      function effects(field: Field): Effect[] {
        return field.list((item) => {
          const type = item.object(
            'type',
            'identity',
            'flag',
            'text',
            'message',
            'resource',
          )('type').value
          switch (type) {
            case 'session':
              return { type, identity: identity(item.object('type', 'identity')('identity')) }
            case 'flag':
              return { type, flag: item.object('type', 'flag')('flag').ref(flags, 'flag') }
            case 'message':
              return { type, text: item.object('type', 'text')('text').text() }
            case 'resourceLink':
              return { type, resource: item.object('type', 'resource')('resource').id() }
            case 'deliverMail':
              return {
                type,
                message: item.object('type', 'message')('message').ref(inboxIds, 'inbox message'),
              }
            default:
              return item.at('type', type).fail('Unsupported effect.')
          }
        })
      }

      const programs = new Map<string, Promise<Program>>()
      async function loadProgram(path: string): Promise<Program> {
        const { value } = await json(path)
        const validation = await engine.validate(value)
        if (!validation.ok) engineFailure(path, validation.error)
        return value as Program
      }

      async function binding(field: Field, legacy: boolean): Promise<PuzzleBinding> {
        const get = field.object(
          'label',
          'puzzle',
          'input',
          'initial',
          'access',
          'success',
          'failure',
          'rejected',
          ...(legacy ? [] : ['command', 'actionLabel', 'submitLabel']),
        )
        const command: PuzzleCommand = legacy
          ? 'login'
          : get('command').ref(['login', 'route', 'reconcile'] as const, 'puzzle command')
        const label = get('label').text()
        const initial = get('initial').optional((item) => item.text(true)) ?? ''
        const path = folder + get('puzzle').asset(true)
        if (!programs.has(path)) programs.set(path, loadProgram(path))
        const program = await programs.get(path)!
        const input = get('input').ref(program.inputs, 'puzzle input')
        if (program.inputs.length !== 1)
          get('puzzle').fail('Puzzle bindings must declare exactly one input.')
        const baseline = await engine.evaluate(program, { [input]: initial })
        if (!baseline.ok) engineFailure(path, baseline.error)
        return {
          command,
          actionLabel: legacy ? 'Login' : get('actionLabel').text(),
          submitLabel: legacy ? 'Submit login' : get('submitLabel').text(),
          label,
          input,
          initial,
          program,
          access: get('access').optional(guard),
          success: effects(get('success')),
          failure: get('failure').text(),
          rejected:
            get('rejected').optional((field) =>
              field.list((item) => {
                const get = item.object('check', 'message')
                return {
                  check: get('check').ref(
                    program.checks.map(({ id }) => id),
                    'puzzle check',
                  ),
                  message: get('message').text(),
                }
              }),
            ) ?? [],
        }
      }

      const hostIds = new Set<string>()
      const resourceIds = new Set<string>()
      const fileIds: string[] = []

      async function host(field: Field): Promise<Host> {
        const get = field.object(
          'id',
          'name',
          'guest',
          'welcome',
          'discover',
          'resources',
          'login',
          'operation',
          'status',
        )
        if (get('login').value !== undefined && get('operation').value !== undefined)
          get('operation').fail('Define one puzzle binding per host.')
        const id = get('id').unique(hostIds)
        const paths = new Map<string, string>()
        const resources = await Promise.all(
          get('resources').list(async (field): Promise<Resource> => {
            const resource = field.object(
              'id',
              'path',
              'type',
              'content',
              'access',
              'discover',
              'denied',
              'inspectLines',
              'inspectNotation',
              'onRead',
            )
            const id = resource('id').unique(resourceIds)
            const location = resource('path')
            const path = location.text()
            if (
              !virtualPath.test(path) ||
              path.split('/').some((part) => part === '.' || part === '..')
            )
              location.fail('Expected a canonical absolute resource path.')
            if (paths.has(path)) location.fail(`Duplicate path "${path}".`)
            const type = resource('type').ref(['directory', 'file', 'mail'], 'resource type')
            paths.set(path, type)
            const base = {
              id,
              path,
              access: resource('access').optional(guard),
              discover: resource('discover').optional(guard),
              denied: resource('denied').optional((item) => item.text()),
            }
            if (type === 'directory') {
              field.object('id', 'path', 'type', 'access', 'discover', 'denied')
              return { ...base, type }
            }
            const onRead = resource('onRead').optional(effects) ?? []
            if (type === 'mail') {
              fileIds.push(id)
              if (resource('inspectNotation').value !== undefined)
                resource('inspectNotation').fail('Scalar notation applies to plain-text files.')
              if (resource('inspectLines').value !== undefined)
                resource('inspectLines').fail('Character lines apply to plain-text files.')
              const messages = await mailMessages(folder + resource('content').asset(true))
              return { ...base, type, messages, onRead }
            }
            fileIds.push(id)
            const content = folder + resource('content').asset()
            const body = await text(content)
            if (body.length > 32_768)
              invalid(content, '', 'Resource text exceeds 32,768 UTF-16 units.')
            const lines = body.split(/\r?\n/u)
            const inspectLines =
              resource('inspectLines').optional((item) => {
                const seen = new Set<number>()
                let points = 0
                return item.list((field) => {
                  const line = field.value
                  if (
                    typeof line !== 'number' ||
                    !Number.isInteger(line) ||
                    !lines[line - 1] ||
                    seen.has(line)
                  )
                    return field.fail(
                      'Expected a unique, nonempty file line number (starting at 1).',
                    )
                  seen.add(line)
                  points += Array.from(lines[line - 1]).length
                  if (points > 256)
                    field.fail('Interactive lines are limited to 256 code points per file.')
                  return line
                })
              }) ?? []
            const inspectNotation =
              resource('inspectNotation').optional((item) => item.bool()) ?? false
            if (inspectNotation) {
              if (inspectLines.length)
                resource('inspectNotation').fail(
                  'Choose either notation links or interactive lines.',
                )
              const invalid = invalidNotation(body)
              if (invalid)
                resource('inspectNotation').fail(
                  `Invalid scalar notation "${invalid}" in ${content}.`,
                )
            }
            return { ...base, type: 'file', text: body, inspectLines, inspectNotation, onRead }
          }),
        )
        for (const resource of resources) {
          const parent = parentPath(resource.path)
          if (parent !== '/' && paths.get(parent) !== 'directory')
            get('resources').fail(`${resource.path} requires a directory at ${parent}.`)
        }
        const operation =
          (await get('login').optional((item) => binding(item, true))) ??
          (await get('operation').optional((item) => binding(item, false)))
        for (const effect of [
          ...(operation?.success ?? []),
          ...resources.flatMap((resource) =>
            resource.type === 'directory' ? [] : resource.onRead,
          ),
        ]) {
          if (effect.type === 'resourceLink' && !resources.some(({ id }) => id === effect.resource))
            get('resources').fail(`Unknown linked resource "${effect.resource}" on host "${id}".`)
        }
        const status =
          get('status').optional((item) =>
            item.list((field) => {
              const row = field.object('label', 'value', 'after')
              return {
                label: row('label').text(),
                value: row('value').text(),
                after: row('after').optional((item) => {
                  const after = item.object('flag', 'value')
                  return { flag: after('flag').ref(flags, 'flag'), value: after('value').text() }
                }),
              }
            }),
          ) ?? []
        return {
          id,
          name: get('name').text(),
          guest: identity(get('guest')),
          welcome: get('welcome').text(),
          discover: get('discover').optional((item) => item.ref(flags, 'flag')),
          resources,
          operation,
          status,
        }
      }

      const hosts = await Promise.all(get('hosts').list(host))
      if (!hosts.length) get('hosts').fail('Expected at least one host.')
      if (hosts.every((host) => host.discover))
        get('hosts').fail('At least one host must be initially discoverable.')
      const objective = get('objective').object('text', 'read', 'message', 'onComplete')
      const onComplete =
        objective('onComplete').optional((field) =>
          field.list((item): ProgressEffect => {
            const type = item.object('type', 'message', 'scenario')('type')
            switch (type.value) {
              case 'discover':
                return {
                  type: 'discover',
                  scenario: item.object('type', 'scenario')('scenario').id(),
                }
              case 'deliverMail':
                return {
                  type: 'deliverMail',
                  message: item.object('type', 'message')('message').ref(inboxIds, 'inbox message'),
                }
              default:
                return type.fail('Unsupported completion effect.')
            }
          }),
        ) ?? []
      return {
        id: entry.id,
        available: entry.available,
        initiallyDiscovered: entry.initiallyDiscovered,
        title: get('title').text(),
        introduction: get('introduction').text(),
        roles,
        flags,
        local: identity(get('local')),
        initialHost: get('initialHost').optional((item) =>
          item.ref(
            hosts.filter((host) => !host.discover).map(({ id }) => id),
            'initially discoverable host',
          ),
        ),
        hosts,
        inbox,
        objective: {
          text: objective('text').text(),
          read: objective('read').ref(fileIds, 'file resource'),
          message: objective('message').text(),
          onComplete,
        },
      }
    },

    async campaign(entries: ScenarioEntry[]): Promise<Scenario[]> {
      const scenarios = await Promise.all(entries.map(loader.scenario))
      const reachable = new Set(
        scenarios.filter((item) => item.available && item.initiallyDiscovered),
      )
      const destinations = new Map(scenarios.map((scenario) => [scenario.id, scenario]))
      const messages = new Set<string>()
      for (const [index, scenario] of scenarios.entries()) {
        const file = entries[index].scenario
        for (const { id } of scenario.inbox?.messages ?? []) {
          if (messages.has(id)) invalid(file, 'inbox', `Duplicate campaign message "${id}".`)
          messages.add(id)
        }
        for (const effect of scenario.objective.onComplete) {
          if (effect.type !== 'discover') continue
          const target = destinations.get(effect.scenario)
          if (!target?.available || target === scenario)
            invalid(
              file,
              'objective.onComplete',
              `Invalid discovery destination "${effect.scenario}".`,
            )
        }
      }
      for (const scenario of reachable)
        for (const effect of scenario.objective.onComplete)
          if (effect.type === 'discover') reachable.add(destinations.get(effect.scenario)!)
      for (const scenario of scenarios)
        if (scenario.available && !reachable.has(scenario))
          invalid('manifest.json', 'scenarios', `Unreachable scenario "${scenario.id}".`)
      return scenarios
    },
  }
  return loader
}
