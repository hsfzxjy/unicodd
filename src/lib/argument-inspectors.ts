import { inspect, projectCommandText, type Point, type Span } from './unicode.ts'

const encoder = new TextEncoder()
const hex = (value: number, width: number) => value.toString(16).toUpperCase().padStart(width, '0')

function utf8Units(scalar: string) {
  return Array.from(encoder.encode(scalar), (byte) => hex(byte, 2))
}

interface InspectorDefinition {
  label: string
  units: (point: Point) => string[]
  describe: (point: Point, offset: number, units: string[]) => string
  requiresScalars?: boolean
}

export const argumentInspectors = {
  'code-points': {
    label: 'Code points',
    units: (point) => [point.notation],
    describe: (point, offset) => `${offset + 1}. ${point.notation}, ${point.glyph}`,
  },
  'utf-8': {
    label: 'UTF-8',
    units: (point) => utf8Units(point.scalar),
    describe: (point, offset, units) =>
      `Byte offset 0x${hex(offset, 4)}, ${units.join(' ')}, ${point.notation}`,
    requiresScalars: true,
  },
  'utf-16': {
    label: 'UTF-16',
    units: ({ scalar }) => scalar.split('').map((unit) => hex(unit.charCodeAt(0), 4)),
    describe: (point, offset, units) =>
      `Unit offset 0x${hex(offset, 4)}, ${units.join(' ')}, ${point.notation}`,
  },
  'wtf-8': {
    label: 'WTF-8',
    units: ({ valid, scalar }) => {
      if (valid) return utf8Units(scalar)
      // WTF-8 encodes an isolated surrogate with the three-byte UTF-8 bit layout.
      const unit = scalar.charCodeAt(0)
      return [0xe0 | (unit >> 12), 0x80 | ((unit >> 6) & 0x3f), 0x80 | (unit & 0x3f)].map((byte) =>
        hex(byte, 2),
      )
    },
    describe: (point, offset, units) =>
      `Byte offset 0x${hex(offset, 4)}, ${units.join(' ')}, ${point.notation}`,
  },
} satisfies Record<string, InspectorDefinition>

export type ArgumentInspector = keyof typeof argumentInspectors
export const argumentInspectorIds = Object.keys(argumentInspectors) as ArgumentInspector[]

export function inspectArgument(source: string, literal: boolean) {
  const { text, escapes, error } = literal
    ? { text: source, escapes: [], error: undefined }
    : projectCommandText(source)
  let escapeIndex = 0
  let extra = 0
  let start = 0
  let malformed: number | undefined
  const points = inspect(text).map((point) => {
    while (escapeIndex < escapes.length && escapes[escapeIndex].decoded < point.end) {
      const escape = escapes[escapeIndex++]
      extra += escape.end - escape.start - escape.width
    }
    if (!point.valid) malformed ??= point.start
    const raw = { ...point, start, end: point.end + extra }
    start = raw.end
    return raw
  })
  return { points, error, malformed }
}

export function encodeArgument(
  kind: ArgumentInspector,
  { points, error, malformed }: ReturnType<typeof inspectArgument>,
) {
  const definition: InspectorDefinition = argumentInspectors[kind]
  if (definition.requiresScalars && malformed !== undefined)
    error ??= `Unpaired surrogate at UTF-16 offset ${malformed}.`

  let total = 0
  const groups = error
    ? []
    : points.map((point) => {
        const offset = total
        const units = definition.units(point)
        total += units.length
        return {
          point,
          offset,
          endOffset: total,
          text: units.join(' '),
          description: definition.describe(point, offset, units),
        }
      })
  return { groups, total, error }
}

export function inspectorSelection(
  { groups, total }: ReturnType<typeof encodeArgument>,
  { start, end }: Span,
) {
  const first = groups.findIndex(({ point }) => point.end > start)
  if (first === -1) return { caretIndex: total }
  const head = groups[first]
  if (start === end) return { caretIndex: start > head.point.start ? head.endOffset : head.offset }

  let last = first
  while (last + 1 < groups.length && groups[last + 1].point.start < end) last++
  const tail = groups[last]
  return {
    selected: {
      start: head.point.start,
      end: tail.point.end,
      units: { start: head.offset, end: tail.endOffset },
      points: groups.slice(first, last + 1).map(({ point }) => point),
    },
  }
}
