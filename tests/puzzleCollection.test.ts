import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeGraph } from '../src/engine/execute';
import type { RawRelationshipIndex } from '../src/explorer/discoveryTypes';
import { UnicodeRelationshipIndex } from '../src/explorer/relationships';
import { requiresDiscoveryIndex } from '../src/puzzles/capabilities';
import { puzzleCollection } from '../src/puzzles/collection';
import { decodeUtf16Strict, parseUtf16Units, preparePuzzleInput } from '../src/puzzles/input';
import type { PreparedPuzzleInput, PuzzleOperations } from '../src/puzzles/types';
import type { UnicodeWasmAdapter } from '../src/wasm/adapter';
import { instantiateUnicodeEngine } from '../src/wasm/loader';

describe('Milestone 6 puzzle collection', () => {
  let adapter: UnicodeWasmAdapter;
  let historicalAdapter: UnicodeWasmAdapter;
  let relationships: UnicodeRelationshipIndex;
  let operations: PuzzleOperations;

  beforeAll(async () => {
    const [wasm, historicalWasm, relationshipJson] = await Promise.all([
      readFile(new URL('../public/wasm/unicodd_ops_core.wasm', import.meta.url)),
      readFile(new URL('../public/wasm/unicodd_unicode_15.wasm', import.meta.url)),
      readFile(
        new URL('../public/unicode-indexes/relationships-17.0.0.json', import.meta.url),
        'utf8',
      ),
    ]);
    adapter = await instantiateUnicodeEngine(wasm);
    historicalAdapter = await instantiateUnicodeEngine(historicalWasm);
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
      normalizeHistorical: (form, input) => historicalAdapter.normalize(form, input),
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
    'historical-normalization': { input: '\ua7f1' },
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

  it('defines nine stable, independently identified puzzles', () => {
    expect(puzzleCollection).toHaveLength(9);
    expect(puzzleCollection.map(({ definition }) => definition.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(new Set(puzzleCollection.map(({ definition }) => definition.id)).size).toBe(9);
  });

  it('declares the optional data capabilities used by each puzzle', () => {
    expect(
      Object.fromEntries(
        puzzleCollection.map(({ definition }) => [definition.id, definition.capabilities]),
      ),
    ).toEqual({
      'nfc-concatenation-boundary': ['normalization'],
      'encoding-lengths': ['grapheme-segmentation'],
      'grapheme-many-scalars': ['grapheme-segmentation'],
      'case-fold-collision': ['case-folding'],
      'compatibility-normalization': ['normalization'],
      'confusable-skeleton-collision': ['normalization', 'confusable-index'],
      'invisible-format-controls': ['property-index'],
      'malformed-utf16': [],
      'historical-normalization': ['normalization', 'historical-normalization'],
    });

    expect(
      puzzleCollection
        .filter(({ definition }) => requiresDiscoveryIndex(definition))
        .map(({ definition }) => definition.id),
    ).toEqual(['confusable-skeleton-collision', 'invisible-format-controls']);
  });

  it('evaluates unrelated puzzles without discovery-index operations', () => {
    const operationsWithoutDiscovery: PuzzleOperations = {
      normalize: operations.normalize,
      caseFold: operations.caseFold,
      graphemeBoundaries: operations.graphemeBoundaries,
      normalizeHistorical: operations.normalizeHistorical,
    };
    const independentPuzzleIds = puzzleCollection
      .filter(({ definition }) => !requiresDiscoveryIndex(definition))
      .map(({ definition }) => definition.id);

    for (const id of independentPuzzleIds) {
      const { runtime, inputs } = prepare(id, solutions[id]!);
      expect(runtime.evaluate(inputs, operationsWithoutDiscovery).success, id).toBe(true);
    }
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

    const historical = prepare('historical-normalization', solutions['historical-normalization']!);
    const historicalTrace = executeGraph(
      historical.runtime.createGraph(operations),
      historical.runtime.createSources(historical.inputs),
    );
    expect(historicalTrace.outputs.get('unicode-15')).toEqual({
      kind: 'scalars',
      value: Uint32Array.of(0xa7f1),
    });
    expect(historicalTrace.outputs.get('unicode-17')).toEqual({
      kind: 'scalars',
      value: Uint32Array.of(0x53),
    });
    expect(historicalTrace.outputs.get('compare')).toEqual({ kind: 'boolean', value: true });
  });

  it('documents every operation shown in the circuit graph', () => {
    for (const puzzle of puzzleCollection) {
      const nodes = puzzle.createGraph(operations).nodes;
      expect(nodes.length, puzzle.definition.id).toBeGreaterThan(0);
      for (const node of nodes) {
        expect(
          node.explanation.trim().length,
          `${puzzle.definition.id}:${node.id}`,
        ).toBeGreaterThan(20);
      }
    }
  });
});
