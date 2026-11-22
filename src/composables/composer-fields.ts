import { commandDefinition, composerArguments, type CommandName } from '../lib/commands'
import type { OperationBinding } from '../lib/scenario'

const collationLocales = ['en-US', 'sv-SE']
const collationStrengths = ['primary', 'secondary', 'tertiary']
const casingProfiles = ['und', 'tr', 'az', 'lt', 'fold']
const routingKeys = ['registration', 'default-lower', 'turkish-lower', 'fold', 'collation']
const hostProfiles = ['transitional', 'nontransitional']
const unicodeVersions = ['15.1', '18.0']
const extractionTargets = ['posix-cs', 'apfs-ci', 'win32-compat']

// These are closed evaluator options. Values with their own syntax, such as cursors,
// search profiles and explicit mappings, keep their text editors.
const choicesByCommand: Partial<Record<CommandName, Record<string, readonly string[]>>> = {
  collate: { locale: collationLocales, strength: collationStrengths },
  replay: {
    locale: collationLocales,
    strength: collationStrengths,
    'cursor-strategy': ['title', 'composite', 'inclusive'],
  },
  casing: { profile: casingProfiles },
  lookup: { profile: casingProfiles },
  probe: { 'routing-key': routingKeys },
  bind: { 'routing-key': routingKeys },
  prepare: {
    'identity-key': ['registration', 'skeleton', 'name', 'fold'],
    originals: ['preserve', 'nfc'],
  },
  preview: {
    units: ['utf16', 'scalar', 'grapheme'],
    bidi: ['raw', 'isolate', 'isolate-first'],
    controls: ['raw', 'escape', 'reject'],
  },
  resolve: { profile: hostProfiles },
  dispatch: { profile: hostProfiles },
  deframe: {
    framing: ['be', 'le', 'scalars'],
    decoder: ['strict', 'chunks', 'replacement'],
    errors: ['quarantine', 'stop'],
    integrity: ['raw', 'nfc'],
  },
  identifier: { version: unicodeVersions },
  mirror: {
    'label-storage': ['opaque', 'nfc', 'ascii', 'identifier', 'authorization'],
    'search-version': unicodeVersions,
  },
  source: { view: ['body', 'fold', 'json', 'fields'] },
  'map-span': { 'offset-space': ['json', 'bytes', 'graphemes', 'scalars', 'utf16'] },
  redact: {
    replacement: ['omit', 'marker'],
    exports: [
      'fresh',
      'preview',
      'cache',
      'source-json',
      'source-name',
      'source-digest',
      'source-log',
      'double-encode',
    ],
  },
  surfaces: { surface: ['body', 'json', 'index', 'metadata', 'names', 'manifest', 'log'] },
  'probe-path': {
    target: extractionTargets,
    transform: ['raw', 'nfc', 'lower', 'nfkc', 'ascii'],
  },
  extract: { target: ['all', ...extractionTargets] },
}

export function composerFields(name: CommandName, operations: readonly OperationBinding[]) {
  const choices = choicesByCommand[name]
  const argumentsInOrder = commandDefinition(name)!.arguments
  return composerArguments(name, operations).map((field, index) => ({
    ...field,
    choices: choices?.[argumentsInOrder[index].name],
  }))
}
