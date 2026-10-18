import type { PuzzleCapability, PuzzleDefinition, PuzzleInputDefinition } from './types';
import { validatePuzzleTranslations } from './localization';

export const puzzleRuntimeIds = [
  'nfc-concatenation-boundary',
  'encoding-lengths',
  'grapheme-many-scalars',
  'case-fold-collision',
  'compatibility-normalization',
  'confusable-skeleton-collision',
  'invisible-format-controls',
  'malformed-utf16',
  'historical-normalization',
] as const;

export type PuzzleRuntimeId = (typeof puzzleRuntimeIds)[number];

export interface PuzzleCatalogEntry {
  runtime: PuzzleRuntimeId;
  definition: PuzzleDefinition;
}

type InputContract = {
  id: string;
  kind: PuzzleInputDefinition['kind'];
};

const runtimeContracts: Record<
  PuzzleRuntimeId,
  {
    inputs: readonly InputContract[];
    capabilities: readonly PuzzleCapability[];
    historicalProfile?: string;
  }
> = {
  'nfc-concatenation-boundary': {
    inputs: [
      { id: 'left', kind: 'text' },
      { id: 'right', kind: 'text' },
    ],
    capabilities: ['normalization'],
  },
  'encoding-lengths': {
    inputs: [{ id: 'input', kind: 'text' }],
    capabilities: ['grapheme-segmentation'],
  },
  'grapheme-many-scalars': {
    inputs: [{ id: 'input', kind: 'text' }],
    capabilities: ['grapheme-segmentation'],
  },
  'case-fold-collision': {
    inputs: [
      { id: 'left', kind: 'text' },
      { id: 'right', kind: 'text' },
    ],
    capabilities: ['case-folding'],
  },
  'compatibility-normalization': {
    inputs: [{ id: 'input', kind: 'text' }],
    capabilities: ['normalization'],
  },
  'confusable-skeleton-collision': {
    inputs: [
      { id: 'left', kind: 'text' },
      { id: 'right', kind: 'text' },
    ],
    capabilities: ['normalization', 'confusable-index'],
  },
  'invisible-format-controls': {
    inputs: [{ id: 'input', kind: 'text' }],
    capabilities: ['property-index'],
  },
  'malformed-utf16': {
    inputs: [{ id: 'input', kind: 'utf16-units' }],
    capabilities: [],
  },
  'historical-normalization': {
    inputs: [{ id: 'input', kind: 'text' }],
    capabilities: ['normalization', 'historical-normalization'],
    historicalProfile: 'unicode-15.1',
  },
};

const capabilities = new Set<PuzzleCapability>([
  'normalization',
  'case-folding',
  'grapheme-segmentation',
  'confusable-index',
  'property-index',
  'historical-normalization',
]);
const runtimeIds = new Set<string>(puzzleRuntimeIds);
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const puzzleFiles = import.meta.glob('./definitions/*.json', {
  eager: true,
  import: 'default',
});

export const puzzleCatalog = loadPuzzleCatalog(puzzleFiles);
validatePuzzleTranslations(puzzleCatalog.map(({ definition }) => definition));

export function loadPuzzleCatalog(files: Readonly<Record<string, unknown>>): PuzzleCatalogEntry[] {
  const entries = Object.entries(files).map(([source, value]) => parsePuzzleFile(value, source));
  const ids = new Set<string>();
  const numbers = new Set<number>();

  for (const { definition } of entries) {
    if (ids.has(definition.id)) fail(definition.id, `Duplicate puzzle id “${definition.id}”.`);
    if (numbers.has(definition.number)) {
      fail(definition.id, `Duplicate puzzle number ${definition.number}.`);
    }
    ids.add(definition.id);
    numbers.add(definition.number);
  }

  return entries.sort((left, right) => left.definition.number - right.definition.number);
}

export function parsePuzzleFile(value: unknown, source = 'puzzle JSON'): PuzzleCatalogEntry {
  const record = requireRecord(value, source);
  rejectUnknownKeys(
    record,
    [
      '$schema',
      'runtime',
      'id',
      'number',
      'theme',
      'title',
      'objective',
      'defaultUnicodeProfile',
      'historicalUnicodeProfile',
      'inputs',
      'graphTitle',
      'graphDescription',
      'resultLabel',
      'hints',
      'explanation',
      'capabilities',
    ],
    source,
  );
  const runtime = requireString(record, 'runtime', source);
  if (!runtimeIds.has(runtime)) fail(source, `Unsupported runtime “${runtime}”.`);

  const id = requireString(record, 'id', source);
  if (!idPattern.test(id)) fail(source, 'Puzzle id must be lowercase kebab-case.');
  const number = record.number;
  if (!Number.isInteger(number) || (number as number) < 1) {
    fail(source, 'Puzzle number must be a positive integer.');
  }

  const rawInputs = requireArray(record, 'inputs', source);
  const inputs = rawInputs.map((input, index) => parseInput(input, `${source} input ${index + 1}`));
  if (inputs.length === 0) fail(source, 'A puzzle must declare at least one input.');
  if (new Set(inputs.map(({ id: inputId }) => inputId)).size !== inputs.length) {
    fail(source, 'Puzzle input ids must be unique.');
  }

  const rawCapabilities = requireArray(record, 'capabilities', source);
  const parsedCapabilities = rawCapabilities.map((capability) => {
    if (typeof capability !== 'string' || !capabilities.has(capability as PuzzleCapability)) {
      fail(source, `Unsupported capability “${String(capability)}”.`);
    }
    return capability as PuzzleCapability;
  });
  if (new Set(parsedCapabilities).size !== parsedCapabilities.length) {
    fail(source, 'Puzzle capabilities must be unique.');
  }

  const hints = parseStringArray(record, 'hints', source);
  if (hints.length === 0) fail(source, 'A puzzle must provide at least one hint.');

  const definition: PuzzleDefinition = {
    id,
    number: number as number,
    theme: requireString(record, 'theme', source),
    title: requireString(record, 'title', source),
    objective: requireString(record, 'objective', source),
    defaultUnicodeProfile: requireString(record, 'defaultUnicodeProfile', source),
    inputs,
    graphTitle: requireString(record, 'graphTitle', source),
    graphDescription: requireString(record, 'graphDescription', source),
    resultLabel: requireString(record, 'resultLabel', source),
    hints,
    explanation: requireString(record, 'explanation', source),
    capabilities: parsedCapabilities,
  };

  const historicalUnicodeProfile = optionalString(record, 'historicalUnicodeProfile', source);
  if (historicalUnicodeProfile) definition.historicalUnicodeProfile = historicalUnicodeProfile;

  const runtimeId = runtime as PuzzleRuntimeId;
  validateRuntimeContract(runtimeId, definition, source);
  return { runtime: runtimeId, definition };
}

function parseInput(value: unknown, source: string): PuzzleInputDefinition {
  const record = requireRecord(value, source);
  rejectUnknownKeys(
    record,
    ['id', 'label', 'description', 'kind', 'placeholder', 'initialValue'],
    source,
  );
  const id = requireString(record, 'id', source);
  if (!idPattern.test(id)) fail(source, 'Input id must be lowercase kebab-case.');
  const kind = requireString(record, 'kind', source);
  if (kind !== 'text' && kind !== 'utf16-units') {
    fail(source, `Unsupported input kind “${kind}”.`);
  }
  const input: PuzzleInputDefinition = {
    id,
    label: requireString(record, 'label', source),
    description: requireString(record, 'description', source),
    kind,
    initialValue: requirePresentString(record, 'initialValue', source),
  };
  const placeholder = optionalString(record, 'placeholder', source);
  if (placeholder) input.placeholder = placeholder;
  return input;
}

function validateRuntimeContract(
  runtime: PuzzleRuntimeId,
  definition: PuzzleDefinition,
  source: string,
): void {
  const contract = runtimeContracts[runtime];
  const actualInputs = definition.inputs.map(({ id, kind }) => `${id}:${kind}`);
  const expectedInputs = contract.inputs.map(({ id, kind }) => `${id}:${kind}`);
  if (actualInputs.join('|') !== expectedInputs.join('|')) {
    fail(
      source,
      `Runtime “${runtime}” requires inputs ${expectedInputs.join(', ')}; received ${actualInputs.join(', ')}.`,
    );
  }

  if (definition.capabilities.join('|') !== contract.capabilities.join('|')) {
    fail(
      source,
      `Runtime “${runtime}” requires capabilities ${contract.capabilities.join(', ') || 'none'}.`,
    );
  }
  if (contract.historicalProfile !== definition.historicalUnicodeProfile) {
    const requirement = contract.historicalProfile
      ? `requires historicalUnicodeProfile “${contract.historicalProfile}”`
      : 'does not support historicalUnicodeProfile';
    fail(source, `Runtime “${runtime}” ${requirement}.`);
  }
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  source: string,
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(record).find((key) => !allowedKeys.has(key));
  if (unknown) fail(source, `Unknown property “${unknown}”.`);
}

function requireRecord(value: unknown, source: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(source, 'Expected a JSON object.');
  }
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string, source: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(source, `“${key}” must be a non-empty string.`);
  }
  return value;
}

function requirePresentString(
  record: Record<string, unknown>,
  key: string,
  source: string,
): string {
  const value = record[key];
  if (typeof value !== 'string') fail(source, `“${key}” must be a string.`);
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  source: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(source, `“${key}” must be a non-empty string when provided.`);
  }
  return value;
}

function requireArray(record: Record<string, unknown>, key: string, source: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) fail(source, `“${key}” must be an array.`);
  return value;
}

function parseStringArray(record: Record<string, unknown>, key: string, source: string): string[] {
  return requireArray(record, key, source).map((value) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      fail(source, `Every “${key}” entry must be a non-empty string.`);
    }
    return value;
  });
}

function fail(source: string, message: string): never {
  throw new Error(`Invalid puzzle definition (${source}): ${message}`);
}
