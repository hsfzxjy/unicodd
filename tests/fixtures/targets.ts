import type { Target } from '../../src/types'

export const fixtures: readonly Target[] = [
  {
    id: 'fixture-single',
    title: 'Single input fixture',
    description: 'Development fixture',
    objective: 'Compare a text input with its NFC form and check for a zero-width space.',
    payloads: { text: { label: 'Text input', initial: 'Cafe\u0301 👩\u200d💻' } },
    checks: {
      exact: { label: 'NFC equality', detail: 'Exact comparison of the input and its NFC form.' },
      invisible: { label: 'Zero-width space present' },
    },
    program: {
      version: 1,
      inputs: ['text'],
      nodes: [
        { id: 'original', op: 'input', input: 'text' },
        { id: 'normalized', op: 'normalize', args: ['original'], form: 'NFC' },
        { id: 'same', op: 'textEqual', args: ['original', 'normalized'] },
        { id: 'marker', op: 'literal', value: { type: 'text', value: '\u200b' } },
        { id: 'containsMarker', op: 'contains', args: ['original', 'marker'] },
      ],
      checks: [
        { id: 'exact', node: 'same', expected: true },
        { id: 'invisible', node: 'containsMarker', expected: false },
      ],
    },
  },
  {
    id: 'fixture-multiple',
    title: 'Two input fixture',
    description: 'Development fixture',
    objective: 'Compare two text inputs after NFC normalization.',
    payloads: {
      left: { label: 'Left input', initial: 'Cafe\u0301' },
      right: { label: 'Right input', initial: 'Café' },
    },
    checks: { same: { label: 'Normalized values match' } },
    program: {
      version: 1,
      inputs: ['left', 'right'],
      nodes: [
        { id: 'left', op: 'input', input: 'left' },
        { id: 'right', op: 'input', input: 'right' },
        { id: 'leftNfc', op: 'normalize', args: ['left'], form: 'NFC' },
        { id: 'rightNfc', op: 'normalize', args: ['right'], form: 'NFC' },
        { id: 'same', op: 'textEqual', args: ['leftNfc', 'rightNfc'] },
      ],
      checks: [{ id: 'same', node: 'same', expected: true }],
    },
  },
]
