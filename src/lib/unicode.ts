export interface Span {
  start: number
  end: number
}
export interface Point extends Span {
  scalar: string
  notation: string
  glyph: string
  valid: boolean
}

const names = new Map([
  [' ', 'SPACE'],
  ['\t', 'TAB'],
  ['\r', 'CR'],
  ['\n', 'LF'],
  ['\u00a0', 'NBSP'],
  ['\u200b', 'ZWSP'],
  ['\u200c', 'ZWNJ'],
  ['\u200d', 'ZWJ'],
  ['\ufeff', 'BOM'],
])

const categories = [
  [/\p{Lu}/u, 'Uppercase letter'],
  [/\p{Ll}/u, 'Lowercase letter'],
  [/\p{Lt}/u, 'Titlecase letter'],
  [/\p{Lm}/u, 'Modifier letter'],
  [/\p{Lo}/u, 'Other letter'],
  [/\p{Mn}/u, 'Nonspacing mark'],
  [/\p{Mc}/u, 'Spacing mark'],
  [/\p{Me}/u, 'Enclosing mark'],
  [/\p{Nd}/u, 'Decimal number'],
  [/\p{Nl}/u, 'Letter number'],
  [/\p{No}/u, 'Other number'],
  [/\p{Pc}/u, 'Connector punctuation'],
  [/\p{Pd}/u, 'Dash punctuation'],
  [/\p{Ps}/u, 'Open punctuation'],
  [/\p{Pe}/u, 'Close punctuation'],
  [/\p{Pi}/u, 'Initial punctuation'],
  [/\p{Pf}/u, 'Final punctuation'],
  [/\p{Po}/u, 'Other punctuation'],
  [/\p{Sm}/u, 'Math symbol'],
  [/\p{Sc}/u, 'Currency symbol'],
  [/\p{Sk}/u, 'Modifier symbol'],
  [/\p{So}/u, 'Other symbol'],
  [/\p{Zs}/u, 'Space separator'],
  [/\p{Zl}/u, 'Line separator'],
  [/\p{Zp}/u, 'Paragraph separator'],
  [/\p{Cc}/u, 'Control'],
  [/\p{Cf}/u, 'Format'],
  [/\p{Co}/u, 'Private use'],
  [/\p{Cn}/u, 'Unassigned'],
] as const

export function scalarCategory(scalar: string): string | undefined {
  return categories.find(([pattern]) => pattern.test(scalar))?.[1]
}

export function notationTokens(text: string) {
  return text.matchAll(/\bU\+[\p{L}\p{N}_+-]*/gu)
}

export function invalidNotation(text: string): string | undefined {
  for (const [token] of notationTokens(text)) {
    if (!/^U\+[0-9A-F]{4,6}$/u.test(token) || lookup(token) === undefined) return token
  }
}

export function notation(value: number): string {
  return 'U+' + value.toString(16).toUpperCase().padStart(4, '0')
}

const commandEscape = /\\(?:([uU][0-9a-fA-F]{1,6})|[\\"])/gu
const escapeAtOffset = new RegExp(commandEscape.source, 'uy')

function escapeText(raw: string, code: string | undefined) {
  if (!code) return raw[1]
  const value = Number.parseInt(code.slice(1), 16)
  return value <= 0x10ffff ? String.fromCodePoint(value) : undefined
}

export function readCommandEscape(source: string, offset: number) {
  escapeAtOffset.lastIndex = offset
  const match = escapeAtOffset.exec(source)
  if (match) return { text: escapeText(match[0], match[1]), end: escapeAtOffset.lastIndex }
}

export function projectCommandText(source: string) {
  const escapes: { start: number; end: number; decoded: number; width: number }[] = []
  let text = ''
  let cursor = 0
  let error: string | undefined
  for (const match of source.matchAll(commandEscape)) {
    const [raw, code] = match
    const decoded = escapeText(raw, code)
    text += source.slice(cursor, match.index)
    cursor = match.index + raw.length
    if (decoded === undefined) error ??= 'Not a Unicode scalar: ' + raw
    else
      escapes.push({ start: match.index, end: cursor, decoded: text.length, width: decoded.length })
    text += decoded ?? raw
  }
  return { text: text + source.slice(cursor), escapes, error }
}

export function decodeUnicodeEscapes(source: string): { text: string } | { error: string } {
  const { text, escapes, error } = projectCommandText(source)
  if (error) return { error }
  for (const { start, end, decoded } of escapes) {
    const unit = text.charCodeAt(decoded)
    if (
      unit >= 0xd800 &&
      unit <= 0xdfff &&
      !splitsSurrogatePair(text, unit < 0xdc00 ? decoded + 1 : decoded)
    )
      return { error: 'Not a Unicode scalar: ' + source.slice(start, end) }
  }
  return { text }
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
  const glyph = !valid
    ? 'Surrogate'
    : (names.get(scalar) ??
      (/\p{Cc}/u.test(scalar)
        ? 'Control'
        : /[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cf}]/u.test(scalar)
          ? 'Invisible'
          : /\p{Mark}/u.test(scalar)
            ? '◌' + scalar
            : scalar))
  return { scalar, start, end: start + scalar.length, notation: notation(value), glyph, valid }
}

export function inspect(text: string): Point[] {
  return inspectRange(text, 0, Infinity)
}

export function inspectRange(text: string, first: number, limit: number): Point[] {
  const points: Point[] = []
  let offset = 0
  let index = 0
  for (const scalar of text) {
    if (points.length >= limit) break
    if (index++ >= first) points.push(describe(scalar, offset))
    offset += scalar.length
  }
  return points
}

export function pointIndex(text: string, offset: number): number {
  let index = 0
  for (const scalar of text) {
    offset -= scalar.length
    if (offset < 0) break
    index++
  }
  return index
}

function splitsSurrogatePair(text: string, index: number) {
  return (
    text.charCodeAt(index - 1) >= 0xd800 &&
    text.charCodeAt(index - 1) <= 0xdbff &&
    text.charCodeAt(index) >= 0xdc00 &&
    text.charCodeAt(index) <= 0xdfff
  )
}

export function scalarSpan(text: string, { start, end }: Span): Span {
  const splitsStart = Number(splitsSurrogatePair(text, start))
  const splitsEnd = Number(splitsSurrogatePair(text, end))
  if (start === end) return { start: start + splitsStart, end: end + splitsEnd }
  return { start: start - splitsStart, end: end + splitsEnd }
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
  if (
    before &&
    caret !== undefined &&
    caret >= before.start &&
    next.slice(0, before.start) === previous.slice(0, before.start) &&
    next.slice(caret) === previous.slice(before.end)
  ) {
    return (
      raw.slice(0, rawOffset(raw, before.start)) +
      next.slice(before.start, caret) +
      raw.slice(rawOffset(raw, before.end))
    )
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
  return (
    raw.slice(0, rawOffset(raw, start)) +
    next.slice(start, nextEnd) +
    raw.slice(rawOffset(raw, end))
  )
}

export function lookup(query: string): string | undefined {
  if (Array.from(query).length === 1)
    return unpairedSurrogate(query) === undefined ? query : undefined
  const match = /^(?:U\+)?([0-9a-f]{1,6})$/i.exec(query.trim())
  if (!match) return undefined
  const value = Number.parseInt(match[1], 16)
  return value <= 0x10ffff && (value < 0xd800 || value > 0xdfff)
    ? String.fromCodePoint(value)
    : undefined
}

export async function copyText(value: string) {
  if (!navigator.clipboard) throw new Error('Clipboard is unavailable in this browser context.')
  await navigator.clipboard.writeText(value)
}
