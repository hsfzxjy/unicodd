import { describe, expect, it } from 'vitest';
import { executeGraph } from '../src/engine/execute';
import { textMetricsGraph } from '../src/engine/graph';
import { stringToUnicodeScalars } from '../src/unicode';

describe('operation graph execution', () => {
  it('executes in dependency order and retains intermediate values', () => {
    const trace = executeGraph(textMetricsGraph, {
      input: { kind: 'scalars', value: stringToUnicodeScalars('A🧩') },
    });

    expect(trace.order).toEqual(['input', 'utf8', 'length']);
    expect(trace.outputs.get('input')).toEqual({
      kind: 'scalars',
      value: Uint32Array.from([0x41, 0x1f9e9]),
    });
    expect(trace.outputs.get('utf8')).toEqual({
      kind: 'bytes',
      value: Uint8Array.from([0x41, 0xf0, 0x9f, 0xa7, 0xa9]),
    });
    expect(trace.outputs.get('length')).toEqual({ kind: 'count', value: 5 });
  });

  it('reports a zero byte length for empty input', () => {
    const trace = executeGraph(textMetricsGraph, {
      input: { kind: 'scalars', value: new Uint32Array() },
    });

    expect(trace.outputs.get('length')).toEqual({ kind: 'count', value: 0 });
  });

  it('rejects a source value with the wrong representation', () => {
    expect(() =>
      executeGraph(textMetricsGraph, {
        input: { kind: 'utf16', value: Uint16Array.from([0x41]) },
      }),
    ).toThrow(/produced utf16; expected scalars/);
  });
});
