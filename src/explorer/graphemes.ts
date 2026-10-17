import {
  scalarOffsetAtUtf16Boundary,
  stringToUnicodeScalars,
  utf16OffsetAtScalarOffset,
} from '../unicode';
import type { GraphemeRange, TextSelection } from './types';

export function scalarBoundaries(scalars: Uint32Array): Uint32Array {
  return Uint32Array.from({ length: scalars.length + 1 }, (_, index) => index);
}

export function buildGraphemeRanges(
  scalars: Uint32Array,
  boundaries: Uint32Array,
): GraphemeRange[] {
  if (boundaries.length === 0 || boundaries[0] !== 0) {
    throw new RangeError('Grapheme boundaries must begin at scalar offset zero.');
  }
  if (boundaries[boundaries.length - 1] !== scalars.length) {
    throw new RangeError('Grapheme boundaries must end at the scalar sequence length.');
  }

  const ranges: GraphemeRange[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const scalarStart = boundaries[index];
    const scalarEnd = boundaries[index + 1];
    if (scalarEnd <= scalarStart) throw new RangeError('Grapheme boundaries must increase.');
    ranges.push({
      index,
      scalarStart,
      scalarEnd,
      utf16Start: utf16OffsetAtScalarOffset(scalars, scalarStart),
      utf16End: utf16OffsetAtScalarOffset(scalars, scalarEnd),
      scalars: scalars.slice(scalarStart, scalarEnd),
    });
  }
  return ranges;
}

export function targetForSelection(
  text: string,
  scalars: Uint32Array,
  graphemes: GraphemeRange[],
  selection: TextSelection,
): Uint32Array | null {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);

  if (start !== end) {
    const selected = text.slice(start, end);
    if (!selected) return null;
    return stringToUnicodeScalars(selected);
  }
  if (scalars.length === 0) return null;

  const scalarOffset = scalarOffsetAtUtf16Boundary(text, start);
  const range =
    graphemes.find(
      (candidate) => candidate.scalarStart <= scalarOffset && scalarOffset < candidate.scalarEnd,
    ) ?? graphemes.at(-1);
  return range?.scalars.slice() ?? null;
}

export function selectionContainsRange(selection: TextSelection, range: GraphemeRange): boolean {
  if (selection.start === selection.end) {
    return selection.start >= range.utf16Start && selection.start < range.utf16End;
  }
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  return start < range.utf16End && end > range.utf16Start;
}
