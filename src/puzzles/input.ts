import type { PreparedPuzzleInput, PuzzleInputDefinition } from './types';
import { stringToUnicodeScalars, stringToUtf16CodeUnits } from '../unicode';

export function preparePuzzleInput(
  definition: PuzzleInputDefinition,
  raw: string,
): PreparedPuzzleInput {
  if (definition.kind === 'utf16-units') {
    try {
      const utf16 = parseUtf16Units(raw);
      return {
        definition,
        raw,
        utf16,
        scalars: decodeUtf16Strict(utf16),
        error: null,
      };
    } catch (reason) {
      return {
        definition,
        raw,
        utf16: null,
        scalars: null,
        error: reason instanceof Error ? reason.message : 'Invalid UTF-16 code-unit input.',
      };
    }
  }

  const utf16 = stringToUtf16CodeUnits(raw);
  try {
    return {
      definition,
      raw,
      utf16,
      scalars: stringToUnicodeScalars(raw),
      error: null,
    };
  } catch (reason) {
    return {
      definition,
      raw,
      utf16,
      scalars: null,
      error: reason instanceof Error ? reason.message : 'Text contains malformed UTF-16.',
    };
  }
}

export function parseUtf16Units(value: string): Uint16Array {
  const trimmed = value.trim();
  if (!trimmed) return new Uint16Array();

  const values = trimmed.split(/[\s,]+/).map((token, index) => {
    const hex = token.replace(/^0x/i, '').replace(/^U\+/i, '');
    if (!/^[0-9a-f]{1,4}$/i.test(hex)) {
      throw new RangeError(`Invalid UTF-16 unit “${token}” at position ${index + 1}.`);
    }
    return Number.parseInt(hex, 16);
  });
  return Uint16Array.from(values);
}

export function decodeUtf16Strict(units: Uint16Array): Uint32Array | null {
  const scalars: number[] = [];
  for (let index = 0; index < units.length; index += 1) {
    const first = units[index] ?? 0;
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = units[index + 1];
      if (second === undefined || second < 0xdc00 || second > 0xdfff) return null;
      scalars.push((first - 0xd800) * 0x400 + (second - 0xdc00) + 0x10000);
      index += 1;
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      return null;
    } else {
      scalars.push(first);
    }
  }
  return Uint32Array.from(scalars);
}

export function isWellFormedUtf16(units: Uint16Array): boolean {
  return decodeUtf16Strict(units) !== null;
}

export function formatUtf16Units(units: Uint16Array): string {
  return units.length
    ? Array.from(units, (unit) => unit.toString(16).toUpperCase().padStart(4, '0')).join(' ')
    : 'Empty sequence';
}
