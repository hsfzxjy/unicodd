import { describe, expect, it } from 'vitest';
import {
  displayScalar,
  inspectScalar,
  scalarOffsetAtUtf16Boundary,
  scalarIndexAtUtf16Offset,
  stringToUnicodeScalars,
  stringToUtf16CodeUnits,
  utf8EncodeScalars,
} from '../src/unicode';

describe('Unicode representations', () => {
  it('extracts Unicode scalar values without normalizing combining sequences', () => {
    const scalars = stringToUnicodeScalars('e\u0301');

    expect(Array.from(scalars)).toEqual([0x65, 0x301]);
    expect(Array.from(utf8EncodeScalars(scalars))).toEqual([0x65, 0xcc, 0x81]);
  });

  it('represents non-BMP characters as one scalar and two UTF-16 units', () => {
    expect(Array.from(stringToUnicodeScalars('🧩'))).toEqual([0x1f9e9]);
    expect(Array.from(stringToUtf16CodeUnits('🧩'))).toEqual([0xd83e, 0xdde9]);

    const inspection = inspectScalar(0x1f9e9);
    expect(inspection.codePoint).toBe('U+1F9E9');
    expect(Array.from(inspection.utf8Bytes)).toEqual([0xf0, 0x9f, 0xa7, 0xa9]);
  });

  it('keeps the empty string empty in every representation', () => {
    expect(stringToUnicodeScalars('')).toHaveLength(0);
    expect(stringToUtf16CodeUnits('')).toHaveLength(0);
    expect(utf8EncodeScalars(new Uint32Array())).toHaveLength(0);
  });

  it('rejects unpaired surrogates instead of silently replacing them', () => {
    expect(() => stringToUnicodeScalars('\ud800')).toThrow(/Unpaired high surrogate/);
    expect(Array.from(stringToUtf16CodeUnits('\ud800'))).toEqual([0xd800]);
  });

  it('maps UTF-16 cursor offsets to scalar offsets across surrogate pairs', () => {
    expect(scalarIndexAtUtf16Offset('A🧩B', 1)).toBe(1);
    expect(scalarIndexAtUtf16Offset('A🧩B', 2)).toBe(1);
    expect(scalarIndexAtUtf16Offset('A🧩B', 3)).toBe(2);
    expect(scalarOffsetAtUtf16Boundary('A🧩B', 2)).toBe(1);
    expect(scalarOffsetAtUtf16Boundary('A🧩B', 3)).toBe(2);
  });

  it('gives combining and invisible scalars an explicit visible preview', () => {
    expect(displayScalar(0x301)).toBe('◌́');
    expect(displayScalar(0x200b)).toBe('ZWSP');
    expect(displayScalar(0xfe0f)).toBe('VS16');
  });
});
