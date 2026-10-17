import { describe, expect, it } from 'vitest';
import { applyEditorAction } from '../src/explorer/editing';
import {
  buildGraphemeRanges,
  selectionContainsRange,
  targetForSelection,
} from '../src/explorer/graphemes';
import { moveHistory, pushHistory, type ExplorerHistory } from '../src/explorer/history';
import { stringToUnicodeScalars } from '../src/unicode';

describe('grapheme-aware exploration', () => {
  const text = 'e\u0301🧩\u200b';
  const scalars = stringToUnicodeScalars(text);
  const ranges = buildGraphemeRanges(scalars, Uint32Array.from([0, 2, 3, 4]));

  it('maps scalar grapheme boundaries to UTF-16 editor ranges', () => {
    expect(ranges.map(({ utf16Start, utf16End }) => [utf16Start, utf16End])).toEqual([
      [0, 2],
      [2, 4],
      [4, 5],
    ]);
    expect(Array.from(ranges[0].scalars)).toEqual([0x65, 0x301]);
    expect(Array.from(ranges[1].scalars)).toEqual([0x1f9e9]);
  });

  it('opens a selected sequence exactly and a collapsed caret by grapheme', () => {
    expect(Array.from(targetForSelection(text, scalars, ranges, { start: 0, end: 2 })!)).toEqual([
      0x65, 0x301,
    ]);
    expect(Array.from(targetForSelection(text, scalars, ranges, { start: 3, end: 3 })!)).toEqual([
      0x1f9e9,
    ]);
    expect(selectionContainsRange({ start: 2, end: 4 }, ranges[1])).toBe(true);
  });

  it('returns no target for empty input and rejects a selection that bisects a surrogate pair', () => {
    expect(targetForSelection('', new Uint32Array(), [], { start: 0, end: 0 })).toBeNull();
    expect(() => targetForSelection(text, scalars, ranges, { start: 2, end: 3 })).toThrow(
      /Unpaired high surrogate/,
    );
  });
});

describe('explicit editor actions', () => {
  const component = Uint32Array.from([0x65, 0x301]);

  it('inserts at the selection end without replacing selected text', () => {
    expect(applyEditorAction('A🧩B', { start: 1, end: 3 }, component, 'insert')).toEqual({
      text: 'A🧩e\u0301B',
      selection: { start: 5, end: 5 },
    });
  });

  it('replaces only the selected UTF-16 range', () => {
    expect(applyEditorAction('A🧩B', { start: 1, end: 3 }, component, 'replace')).toEqual({
      text: 'Ae\u0301B',
      selection: { start: 3, end: 3 },
    });
  });

  it('appends without transforming the existing string', () => {
    expect(applyEditorAction('①', { start: 0, end: 1 }, component, 'append')).toEqual({
      text: '①e\u0301',
      selection: { start: 3, end: 3 },
    });
  });
});

describe('exploration history', () => {
  it('moves independently, ignores duplicates, and discards a forward branch', () => {
    let history: ExplorerHistory = { entries: [], index: -1 };
    history = pushHistory(history, Uint32Array.of(0xe9));
    history = pushHistory(history, Uint32Array.of(0x65));
    history = pushHistory(history, Uint32Array.of(0x65));
    expect(history.entries).toHaveLength(2);

    history = moveHistory(history, -1);
    history = pushHistory(history, Uint32Array.of(0x301));
    expect(history.entries.map((entry) => Array.from(entry))).toEqual([[0xe9], [0x301]]);
    expect(history.index).toBe(1);
  });
});
