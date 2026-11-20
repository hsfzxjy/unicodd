import { describe, expect, it } from 'vitest'
import { encodeArgument, inspectArgument, inspectorSelection } from '../src/lib/argument-inspectors'
import {
  applyNativeEdit,
  decodeUnicodeEscapes,
  editorText,
  inspect,
  inspectRange,
  lookup,
  pointIndex,
  rawOffset,
  scalarSpan,
  unpairedSurrogate,
} from '../src/lib/unicode'

describe('Unicode editing representations', () => {
  it('decodes Unicode escapes once and rejects non-scalars', () => {
    expect(decodeUnicodeEscapes(String.raw`a\u01f9ea\u000301\u000000b`)).toEqual({
      text: 'a🧪\u0301\0b',
    })
    expect(decodeUnicodeEscapes(String.raw`\\u000041 \u00005cu000042`)).toEqual({
      text: String.raw`\u000041 \u000042`,
    })
    expect(decodeUnicodeEscapes(String.raw`\u1234`)).toEqual({ text: '\u1234' })
    expect(decodeUnicodeEscapes(String.raw`\UAE!\u0z\"\\\u000041F`)).toEqual({
      text: '®!\0z"\\AF',
    })
    expect(decodeUnicodeEscapes(String.raw`\u00D800`)).toHaveProperty('error')
    expect(decodeUnicodeEscapes(String.raw`\u110000`)).toHaveProperty('error')
  })

  it('maps decoded units onto complete escape spellings and handles malformed UTF-16', () => {
    const source = String.raw`a\U1F9EA!\ud800.\uD83E\uDDEA`
    const projection = inspectArgument(source, false)
    expect(projection.points.map(({ start, end, notation }) => [start, end, notation])).toEqual([
      [0, 1, 'U+0061'],
      [1, 8, 'U+1F9EA'],
      [8, 9, 'U+0021'],
      [9, 15, 'U+D800'],
      [15, 16, 'U+002E'],
      [16, 28, 'U+1F9EA'],
    ])
    const caret = { start: 3, end: 3 }
    const wtf = encodeArgument('wtf-8', projection)
    expect(wtf.groups.map(({ text }) => text)).toEqual([
      '61',
      'F0 9F A7 AA',
      '21',
      'ED A0 80',
      '2E',
      'F0 9F A7 AA',
    ])
    expect(wtf.total).toBe(14)
    expect(inspectorSelection(wtf, caret).caretIndex).toBe(5)
    expect(encodeArgument('utf-8', projection).error).toContain('offset 4')
    const utf16 = encodeArgument('utf-16', projection)
    expect(utf16.groups[1].text).toBe('D83E DDEA')
    expect(inspectorSelection(utf16, { start: 2, end: 4 }).selected).toMatchObject({
      start: 1,
      end: 8,
      units: { start: 1, end: 3 },
    })
    expect(inspectArgument(source, true).points).toHaveLength(source.length)
  })

  it('distinguishes UTF-16 offsets, supplementary scalars, marks, and invisible controls', () => {
    const points = inspect('e\u0301👩\u200d💻\u200b\u202e\udc00')
    expect(points.map(({ start, end, notation }) => [start, end, notation])).toEqual([
      [0, 1, 'U+0065'],
      [1, 2, 'U+0301'],
      [2, 4, 'U+1F469'],
      [4, 5, 'U+200D'],
      [5, 7, 'U+1F4BB'],
      [7, 8, 'U+200B'],
      [8, 9, 'U+202E'],
      [9, 10, 'U+DC00'],
    ])
    expect(points.map((point) => point.glyph)).toEqual([
      'e',
      '◌́',
      '👩',
      'ZWJ',
      '💻',
      'ZWSP',
      'Invisible',
      'Surrogate',
    ])
    expect(points.at(-1)?.valid).toBe(false)
  })

  it('snaps a caret out of a surrogate pair and covers complete scalars in ranges', () => {
    const text = 'a🧪e\u0301'
    expect(scalarSpan(text, { start: 2, end: 2 })).toEqual({ start: 3, end: 3 })
    expect(scalarSpan(text, { start: 1, end: 2 })).toEqual({ start: 1, end: 3 })
    expect(scalarSpan(text, { start: 2, end: 4 })).toEqual({ start: 1, end: 4 })
    expect(scalarSpan(text, { start: 4, end: 5 })).toEqual({ start: 4, end: 5 })
    expect(unpairedSurrogate('🧪\ud800x')).toBe(2)
    expect(unpairedSurrogate('🧪e\u0301')).toBeUndefined()
    expect([0, 1, 2, 3, 4, 5].map((offset) => pointIndex(text, offset))).toEqual([0, 1, 1, 2, 3, 4])
    expect(inspectRange(text, 1, 2)).toEqual(inspect(text).slice(1, 3))
  })

  it('preserves untouched CR and CRLF in the raw draft during native edits', () => {
    const raw = 'a\r\nb\rc\n'
    expect(editorText(raw)).toBe('a\nb\nc\n')
    expect([0, 1, 2, 3, 4, 5, 6].map((offset) => rawOffset(raw, offset))).toEqual([
      0, 1, 3, 4, 5, 6, 7,
    ])
    expect(applyNativeEdit(raw, 'a\n🧪b\nc\n', { start: 2, end: 2 }, 4)).toBe('a\r\n🧪b\rc\n')
    expect(applyNativeEdit(raw, 'a\nbc\n', { start: 4, end: 4 }, 3)).toBe('a\r\nbc\n')
    expect(applyNativeEdit('\r\n\n', '\n', { start: 1, end: 1 }, 0)).toBe('\n')
  })

  it('looks up literal scalars and hex while rejecting non-scalar values', () => {
    for (const [input, output] of [
      ['e', 'e'],
      ['7', '7'],
      [' ', ' '],
      ['🧪', '🧪'],
      [' u+1f9ea ', '🧪'],
      ['1F9EA', '🧪'],
      ['U+0000', '\0'],
      ['U+10FFFF', '\u{10ffff}'],
    ])
      expect(lookup(input)).toBe(output)
    for (const input of [
      '',
      'e\u0301',
      '👩\u200d💻',
      'U+D800',
      'DFFF',
      '110000',
      '\udc00',
      'U+G123',
    ]) {
      expect(lookup(input)).toBeUndefined()
    }
  })
})
