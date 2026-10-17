export interface ScalarInspection {
  scalar: number;
  character: string;
  display: string;
  codePoint: string;
  utf8Bytes: Uint8Array;
  utf16Units: Uint16Array;
}

export function isUnicodeScalar(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0x10ffff &&
    !(value >= 0xd800 && value <= 0xdfff)
  );
}

export function stringToUnicodeScalars(value: string): Uint32Array {
  const scalars: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);

    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (!(second >= 0xdc00 && second <= 0xdfff)) {
        throw new RangeError(`Unpaired high surrogate at UTF-16 code-unit offset ${index}.`);
      }
      scalars.push((first - 0xd800) * 0x400 + (second - 0xdc00) + 0x10000);
      index += 1;
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      throw new RangeError(`Unpaired low surrogate at UTF-16 code-unit offset ${index}.`);
    } else {
      scalars.push(first);
    }
  }

  return Uint32Array.from(scalars);
}

export function unicodeScalarsToString(scalars: Uint32Array): string {
  const values = Array.from(scalars);
  const invalidIndex = values.findIndex((value) => !isUnicodeScalar(value));
  if (invalidIndex !== -1) {
    throw new RangeError(`Invalid Unicode scalar value at scalar offset ${invalidIndex}.`);
  }
  return String.fromCodePoint(...values);
}

export function stringToUtf16CodeUnits(value: string): Uint16Array {
  return Uint16Array.from({ length: value.length }, (_, index) => value.charCodeAt(index));
}

export function utf8EncodeScalars(scalars: Uint32Array): Uint8Array {
  return new TextEncoder().encode(unicodeScalarsToString(scalars));
}

export function formatCodePoint(scalar: number): string {
  if (!isUnicodeScalar(scalar)) {
    throw new RangeError('Cannot format an invalid Unicode scalar value.');
  }
  return `U+${scalar.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function formatHex(value: number, width = 2): string {
  return value.toString(16).toUpperCase().padStart(width, '0');
}

export function inspectScalar(scalar: number): ScalarInspection {
  if (!isUnicodeScalar(scalar)) {
    throw new RangeError('Cannot inspect an invalid Unicode scalar value.');
  }

  const character = String.fromCodePoint(scalar);
  return {
    scalar,
    character,
    display: displayScalar(scalar),
    codePoint: formatCodePoint(scalar),
    utf8Bytes: new TextEncoder().encode(character),
    utf16Units: stringToUtf16CodeUnits(character),
  };
}

const visibleSubstitutes = new Map<number, string>([
  [0x0000, 'NUL'],
  [0x0009, '⇥'],
  [0x000a, '↵'],
  [0x000d, 'CR'],
  [0x0020, '␠'],
  [0x00a0, 'NBSP'],
  [0x200b, 'ZWSP'],
  [0x200c, 'ZWNJ'],
  [0x200d, 'ZWJ'],
  [0x2060, 'WJ'],
  [0xfeff, 'BOM'],
]);

export function displayScalar(scalar: number): string {
  if (!isUnicodeScalar(scalar)) return '�';
  const substitute = visibleSubstitutes.get(scalar);
  if (substitute) return substitute;
  if (scalar >= 0xfe00 && scalar <= 0xfe0f) return `VS${scalar - 0xfe00 + 1}`;
  const character = String.fromCodePoint(scalar);
  if (/\p{Mark}/u.test(character)) return `◌${character}`;
  if (/\p{Control}/u.test(character)) return formatCodePoint(scalar);
  return character;
}

export function displaySequence(scalars: Uint32Array): string {
  if (scalars.length === 0) return '∅';
  const text = unicodeScalarsToString(scalars);
  if (
    [...text].some((character) =>
      /[\p{Letter}\p{Number}\p{Symbol}\p{Punctuation}]/u.test(character),
    )
  ) {
    return text;
  }
  return Array.from(scalars, displayScalar).join(' ');
}

export function unicodeScalarArraysEqual(left: Uint32Array, right: Uint32Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function utf16OffsetAtScalarOffset(scalars: Uint32Array, scalarOffset: number): number {
  const bounded = Math.min(Math.max(scalarOffset, 0), scalars.length);
  let codeUnits = 0;
  for (let index = 0; index < bounded; index += 1) {
    codeUnits += scalars[index] > 0xffff ? 2 : 1;
  }
  return codeUnits;
}

export function scalarOffsetAtUtf16Boundary(value: string, codeUnitOffset: number): number {
  const bounded = Math.min(Math.max(codeUnitOffset, 0), value.length);
  let scalarOffset = 0;
  let codeUnits = 0;

  while (codeUnits < bounded) {
    const first = value.charCodeAt(codeUnits);
    const isPair =
      first >= 0xd800 &&
      first <= 0xdbff &&
      value.charCodeAt(codeUnits + 1) >= 0xdc00 &&
      value.charCodeAt(codeUnits + 1) <= 0xdfff;
    const width = isPair ? 2 : 1;
    if (codeUnits + width > bounded) break;
    codeUnits += width;
    scalarOffset += 1;
  }

  return scalarOffset;
}

export function scalarIndexAtUtf16Offset(value: string, codeUnitOffset: number): number | null {
  if (value.length === 0) return null;

  const boundedOffset = Math.min(Math.max(codeUnitOffset, 0), value.length - 1);
  let scalarIndex = 0;

  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    const isPair =
      first >= 0xd800 &&
      first <= 0xdbff &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff;
    const end = index + (isPair ? 1 : 0);

    if (boundedOffset <= end) return scalarIndex;
    index = end;
    scalarIndex += 1;
  }

  return null;
}
