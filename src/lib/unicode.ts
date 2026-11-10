export interface Span { start: number; end: number }
export interface Point extends Span {
  scalar: string
  notation: string
  glyph: string
  valid: boolean
}

const names = new Map([
  [' ', 'SPACE'], ['\t', 'TAB'], ['\r', 'CR'], ['\n', 'LF'], ['\u00a0', 'NBSP'],
  ['\u200b', 'ZWSP'], ['\u200c', 'ZWNJ'], ['\u200d', 'ZWJ'], ['\ufeff', 'BOM'],
])

export function notation(value: number): string {
  return 'U+' + value.toString(16).toUpperCase().padStart(4, '0')
}

export function unpairedSurrogate(text: string): number | undefined {
  let index = 0
  for (const scalar of text) {
    const unit = scalar.charCodeAt(0)
    if (scalar.length === 1 && unit >= 0xd800 && unit <= 0xdfff) return index
    index += scalar.length
  }
}

export function describe(scalar: string, start = 0): Point {
  const value = scalar.codePointAt(0)!
  const valid = unpairedSurrogate(scalar) === undefined
  const glyph = !valid ? 'Surrogate' : names.get(scalar) ??
    (/\p{Cc}/u.test(scalar) ? 'Control' :
      /[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cf}]/u.test(scalar) ? 'Invisible' :
        /\p{Mark}/u.test(scalar) ? '◌' + scalar : scalar)
  return { scalar, start, end: start + scalar.length, notation: notation(value), glyph, valid }
}

export function inspect(text: string): Point[] {
  let offset = 0
  return Array.from(text, scalar => {
    const point = describe(scalar, offset)
    offset = point.end
    return point
  })
}

export function scalarSpan(text: string, { start, end }: Span): Span {
  const splitsPair = (index: number) =>
    text.charCodeAt(index - 1) >= 0xd800 && text.charCodeAt(index - 1) <= 0xdbff &&
    text.charCodeAt(index) >= 0xdc00 && text.charCodeAt(index) <= 0xdfff

  if (start === end && splitsPair(start)) return { start: start + 1, end: end + 1 }
  return { start: start - Number(splitsPair(start)), end: end + Number(splitsPair(end)) }
}

// A textarea exposes CR and CRLF as LF. Track the corresponding raw offsets
// so a native edit does not rewrite line endings elsewhere in the draft.
export function editorText(raw: string) {
  return raw.replace(/\r\n?/g, '\n')
}

export function rawOffset(raw: string, offset: number): number {
  if (!raw.includes('\r')) return Math.min(raw.length, offset)
  let index = 0
  for (let unit = 0; unit < offset && index < raw.length; unit++) {
    if (raw[index] === '\r' && raw[index + 1] === '\n') index++
    index++
  }
  return index
}

export function applyNativeEdit(raw: string, next: string, before?: Span, caret?: number): string {
  const previous = editorText(raw)
  // Prefer the browser selection to distinguish adjacent equal characters.
  if (before && caret !== undefined && caret >= before.start &&
    next.slice(0, before.start) === previous.slice(0, before.start) &&
    next.slice(caret) === previous.slice(before.end)) {
    return raw.slice(0, rawOffset(raw, before.start)) + next.slice(before.start, caret)
      + raw.slice(rawOffset(raw, before.end))
  }
  if (next === previous) return raw

  // A backward deletion can begin before the previous caret.
  let start = 0
  const prefixLimit = caret ?? next.length
  while (start < prefixLimit && start < previous.length && previous[start] === next[start]) start++
  let end = previous.length
  let nextEnd = next.length
  while (end > start && nextEnd > start && previous[end - 1] === next[nextEnd - 1]) {
    end--
    nextEnd--
  }
  return raw.slice(0, rawOffset(raw, start)) + next.slice(start, nextEnd) + raw.slice(rawOffset(raw, end))
}

export function lookup(query: string): string | undefined {
  if (Array.from(query).length === 1) return unpairedSurrogate(query) === undefined ? query : undefined
  const match = /^(?:U\+)?([0-9a-f]{1,6})$/i.exec(query.trim())
  if (!match) return undefined
  const value = Number.parseInt(match[1], 16)
  return value <= 0x10ffff && (value < 0xd800 || value > 0xdfff)
    ? String.fromCodePoint(value) : undefined
}

export async function copyText(value: string) {
  if (!navigator.clipboard) throw new Error('Clipboard is unavailable in this browser context.')
  await navigator.clipboard.writeText(value)
}
