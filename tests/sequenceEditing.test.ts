import { describe, expect, it } from 'vitest';
import {
  insertSequenceValues,
  moveSequenceValue,
  removeSequenceValue,
} from '../src/puzzles/sequenceEditing';

describe('puzzle sequence editing', () => {
  it('moves whole scalar values, including supplementary characters', () => {
    expect(moveSequenceValue([0x61, 0x1f9e9, 0x301], 1, 0)).toEqual([0x1f9e9, 0x61, 0x301]);
    expect(moveSequenceValue([0x61, 0x301, 0x62], 0, 2)).toEqual([0x301, 0x62, 0x61]);
  });

  it('removes exactly one value without changing its neighbors', () => {
    expect(removeSequenceValue([0x65, 0x301, 0x1f9e9], 1)).toEqual([0x65, 0x1f9e9]);
  });

  it('inserts discovered values at a bounded sequence position', () => {
    expect(insertSequenceValues([0x61, 0x62], 1, [0x301, 0x1f9e9])).toEqual([
      0x61, 0x301, 0x1f9e9, 0x62,
    ]);
    expect(insertSequenceValues([], 4, [0x200b])).toEqual([0x200b]);
  });
});
