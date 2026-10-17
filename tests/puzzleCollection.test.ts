import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeGraph } from '../src/engine/execute';
import type { RawRelationshipIndex } from '../src/explorer/discoveryTypes';
import { UnicodeRelationshipIndex } from '../src/explorer/relationships';
import { puzzleCollection } from '../src/puzzles/collection';
import { decodeUtf16Strict, parseUtf16Units, preparePuzzleInput } from '../src/puzzles/input';
import type { PreparedPuzzleInput, PuzzleOperations } from '../src/puzzles/types';
import type { UnicodeWasmAdapter } from '../src/wasm/adapter';
import { instantiateUnicodeEngine } from '../src/wasm/loader';

describe('Milestone 6 puzzle collection', () => {
  let adapter: UnicodeWasmAdapter;
  let relationships: UnicodeRelationshipIndex;
  let operations: PuzzleOperations;

  beforeAll(async () => {
    const [wasm, relationshipJson] = await Promise.all([
      readFile(new URL('../public/wasm/unicodd_ops_core.wasm', import.meta.url)),
      readFile(
        new URL('../public/unicode-indexes/relationships-17.0.0.json', import.meta.url),
        'utf8',
      ),
    ]);
    adapter = await instantiateUnicodeEngine(wasm);
    relationships = new UnicodeRelationshipIndex(
      JSON.parse(relationshipJson) as RawRelationshipIndex,
    );
    operations = {
      normalize: (form, input) => adapter.normalize(form, input),
      caseFold: (input) => adapter.caseFold(input),
      graphemeBoundaries: (input) => adapter.graphemeBoundaries(input),
      confusableSkeleton: (input) =>
        relationships.confusableSkeleton(input, (value) => adapter.normalize('NFD', value)),
      generalCategory: (scalar) => relationships.propertiesFor(scalar)?.generalCategory ?? null,
    };
  });

  const solutions: Record<string, Record<string, string>> = {
    'nfc-concatenation-boundary': { left: 'e', right: '\u0301' },
    'encoding-lengths': { input: '🧩' },
    'grapheme-many-scalars': { input: 'e\u0301\u0323' },
    'case-fold-collision': { left: 'Straße', right: 'STRASSE' },
    'compatibility-normalization': { input: '①' },
    'confusable-skeleton-collision': { left: 'a', right: 'а' },
    'invisible-format-controls': { input: '\u200b' },
    'malformed-utf16': { input: 'D83E' },
  };

  function prepare(id: string, values: Record<string, string>) {
    const runtime = puzzleCollection.find(({ definition }) => definition.id === id);
    if (!runtime) throw new Error(`Missing puzzle ${id}.`);
    const inputs = Object.fromEntries(
      runtime.definition.inputs.map((definition) => [
        definition.id,
        preparePuzzleInput(definition, values[definition.id] ?? ''),
      ]),
    ) as Record<string, PreparedPuzzleInput>;
    return { runtime, inputs };
  }

  it('defines eight stable, independently identified puzzles', () => {
    expect(puzzleCollection).toHaveLength(8);
    expect(puzzleCollection.map(({ definition }) => definition.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(new Set(puzzleCollection.map(({ definition }) => definition.id)).size).toBe(8);
  });

  it('parses raw UTF-16 without replacing unpaired surrogates', () => {
    expect(parseUtf16Units('D83E DDE9')).toEqual(Uint16Array.from([0xd83e, 0xdde9]));
    expect(decodeUtf16Strict(Uint16Array.from([0xd83e, 0xdde9]))).toEqual(Uint32Array.of(0x1f9e9));
    expect(decodeUtf16Strict(Uint16Array.of(0xd83e))).toBeNull();
    expect(() => parseUtf16Units('D83E 10000')).toThrow(/Invalid UTF-16 unit/);
  });

  it.each(Object.entries(solutions))('accepts the intended solution for %s', (id, values) => {
    const { runtime, inputs } = prepare(id, values);
    expect(Object.values(inputs).every(({ error }) => error === null)).toBe(true);
    expect(runtime.evaluate(inputs, operations).success).toBe(true);
  });

  it.each(puzzleCollection.map(({ definition }) => definition.id))(
    'does not solve %s with empty inputs',
    (id) => {
      const { runtime, inputs } = prepare(id, {});
      expect(runtime.evaluate(inputs, operations).success).toBe(false);
    },
  );

  it('executes representative graphs and retains typed intermediates', () => {
    const encoding = prepare('encoding-lengths', solutions['encoding-lengths']!);
    const encodingTrace = executeGraph(
      encoding.runtime.createGraph(operations),
      encoding.runtime.createSources(encoding.inputs),
    );
    expect(encodingTrace.outputs.get('utf8-length')).toEqual({ kind: 'count', value: 4 });
    expect(encodingTrace.outputs.get('utf16-length')).toEqual({ kind: 'count', value: 2 });
    expect(encodingTrace.outputs.get('scalar-length')).toEqual({ kind: 'count', value: 1 });

    const folding = prepare('case-fold-collision', solutions['case-fold-collision']!);
    expect(
      executeGraph(
        folding.runtime.createGraph(operations),
        folding.runtime.createSources(folding.inputs),
      ).outputs.get('compare'),
    ).toEqual({ kind: 'boolean', value: true });

    const malformed = prepare('malformed-utf16', solutions['malformed-utf16']!);
    expect(
      executeGraph(
        malformed.runtime.createGraph(operations),
        malformed.runtime.createSources(malformed.inputs),
      ).outputs.get('valid'),
    ).toEqual({ kind: 'boolean', value: false });
  });
});
