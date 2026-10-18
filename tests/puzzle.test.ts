import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeGraph } from '../src/engine/execute';
import {
  createNormalizationPuzzleGraph,
  evaluateNormalizationPuzzle,
} from '../src/puzzles/normalizationConcatenation';
import { puzzleCollection } from '../src/puzzles/collection';
import { stringToUnicodeScalars } from '../src/unicode';
import type { UnicodeWasmAdapter } from '../src/wasm/adapter';
import { instantiateUnicodeEngine } from '../src/wasm/loader';

describe('normalization concatenation puzzle', () => {
  let adapter: UnicodeWasmAdapter;

  beforeAll(async () => {
    const bytes = await readFile(new URL('../public/wasm/unicodd_ops_core.wasm', import.meta.url));
    adapter = await instantiateUnicodeEngine(bytes);
  });

  function evaluate(left: string, right: string) {
    return evaluateNormalizationPuzzle(
      stringToUnicodeScalars(left),
      stringToUnicodeScalars(right),
      (input) => adapter.normalize('NFC', input),
    );
  }

  it('has a stable declarative definition', () => {
    const definition = puzzleCollection[0]?.definition;
    expect(definition?.id).toBe('nfc-concatenation-boundary');
    expect(definition?.inputs.map(({ id }) => id)).toEqual(['left', 'right']);
    expect(definition?.hints).toHaveLength(3);
  });

  it('accepts two NFC inputs whose concatenation is not NFC', () => {
    const result = evaluate('e', '\u0301');

    expect(result.leftIsNfc).toBe(true);
    expect(result.rightIsNfc).toBe(true);
    expect(result.joinedIsNfc).toBe(false);
    expect(result.success).toBe(true);
    expect(result.joined).toEqual(Uint32Array.from([0x65, 0x301]));
    expect(result.joinedNormalized).toEqual(Uint32Array.of(0xe9));
  });

  it('rejects empty inputs and inputs that are not independently NFC', () => {
    expect(evaluate('e', '').success).toBe(false);
    expect(evaluate('', '\u0301').success).toBe(false);
    expect(evaluate('e\u0301', 'x').leftIsNfc).toBe(false);
    expect(evaluate('e\u0301', 'x').success).toBe(false);
  });

  it('does not award an unrelated supplementary-character pair', () => {
    const result = evaluate('🧩', '\u200d');
    expect(result.leftIsNfc).toBe(true);
    expect(result.rightIsNfc).toBe(true);
    expect(result.joinedIsNfc).toBe(true);
    expect(result.success).toBe(false);
  });

  it('executes the graph and retains normalization intermediates', () => {
    const graph = createNormalizationPuzzleGraph((input) => adapter.normalize('NFC', input));
    const trace = executeGraph(graph, {
      left: { kind: 'scalars', value: Uint32Array.of(0x65) },
      right: { kind: 'scalars', value: Uint32Array.of(0x301) },
    });

    expect(trace.outputs.get('join')).toEqual({
      kind: 'scalars',
      value: Uint32Array.from([0x65, 0x301]),
    });
    expect(trace.outputs.get('joined-nfc')).toEqual({
      kind: 'scalars',
      value: Uint32Array.of(0xe9),
    });
    expect(trace.outputs.get('joined-check')).toEqual({ kind: 'boolean', value: false });
  });
});
