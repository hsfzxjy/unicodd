import type { OperationGraph, OperationValue } from '../engine/types';
import { unicodeScalarArraysEqual } from '../unicode';
import type { NormalizationPuzzleEvaluation, NormalizeNfc, PuzzleDefinition } from './types';

export const normalizationConcatenationPuzzle: PuzzleDefinition = {
  id: 'nfc-concatenation-boundary',
  title: 'A seam in the string',
  objective:
    'Find two non-empty strings that are each NFC-normalized, but whose concatenation is not.',
  defaultUnicodeProfile: 'Unicode 17 / ICU4X 2.3',
  inputs: [
    {
      id: 'left',
      label: 'Input A',
      description: 'The first independently normalized string.',
      initialValue: '',
    },
    {
      id: 'right',
      label: 'Input B',
      description: 'The second independently normalized string.',
      initialValue: '',
    },
  ],
  hints: [
    'Start with é in the explorer and inspect its canonical decomposition.',
    'Try putting the base letter in Input A and the combining mark in Input B.',
    'Each input can be normalized alone while their boundary creates a new composition opportunity.',
  ],
  explanation:
    'NFC is not closed under concatenation. A starter at the end of Input A can compose with a combining mark at the start of Input B, even though each input was already NFC on its own.',
};

export function evaluateNormalizationPuzzle(
  left: Uint32Array,
  right: Uint32Array,
  normalizeNfc: NormalizeNfc,
): NormalizationPuzzleEvaluation {
  const leftNormalized = normalizeNfc(left);
  const rightNormalized = normalizeNfc(right);
  const joined = concatenateScalars(left, right);
  const joinedNormalized = normalizeNfc(joined);
  const leftIsNfc = unicodeScalarArraysEqual(left, leftNormalized);
  const rightIsNfc = unicodeScalarArraysEqual(right, rightNormalized);
  const joinedIsNfc = unicodeScalarArraysEqual(joined, joinedNormalized);

  return {
    leftNormalized,
    rightNormalized,
    joined,
    joinedNormalized,
    leftIsNfc,
    rightIsNfc,
    joinedIsNfc,
    success: left.length > 0 && right.length > 0 && leftIsNfc && rightIsNfc && !joinedIsNfc,
  };
}

export function createNormalizationPuzzleGraph(normalizeNfc: NormalizeNfc): OperationGraph {
  const normalizeOperation = ([input]: readonly OperationValue[]): OperationValue => ({
    kind: 'scalars',
    value: normalizeNfc(requireScalars(input)),
  });
  return {
    nodes: [
      { id: 'left', label: 'Input A', inputKinds: [], outputKind: 'scalars' },
      { id: 'right', label: 'Input B', inputKinds: [], outputKind: 'scalars' },
      {
        id: 'left-nfc',
        label: 'NFC(A)',
        inputKinds: ['scalars'],
        outputKind: 'scalars',
        execute: normalizeOperation,
      },
      {
        id: 'right-nfc',
        label: 'NFC(B)',
        inputKinds: ['scalars'],
        outputKind: 'scalars',
        execute: normalizeOperation,
      },
      {
        id: 'join',
        label: 'Concatenate A + B',
        inputKinds: ['scalars', 'scalars'],
        outputKind: 'scalars',
        execute: ([left, right]): OperationValue => ({
          kind: 'scalars',
          value: concatenateScalars(requireScalars(left), requireScalars(right)),
        }),
      },
      {
        id: 'joined-nfc',
        label: 'NFC(A + B)',
        inputKinds: ['scalars'],
        outputKind: 'scalars',
        execute: normalizeOperation,
      },
      {
        id: 'joined-check',
        label: 'A + B is NFC',
        inputKinds: ['scalars', 'scalars'],
        outputKind: 'boolean',
        execute: ([input, normalized]): OperationValue => ({
          kind: 'boolean',
          value: unicodeScalarArraysEqual(requireScalars(input), requireScalars(normalized)),
        }),
      },
    ],
    edges: [
      { id: 'left-to-left-nfc', source: 'left', target: 'left-nfc' },
      { id: 'right-to-right-nfc', source: 'right', target: 'right-nfc' },
      { id: 'left-to-join', source: 'left', target: 'join' },
      { id: 'right-to-join', source: 'right', target: 'join' },
      { id: 'join-to-joined-nfc', source: 'join', target: 'joined-nfc' },
      { id: 'join-to-joined-check', source: 'join', target: 'joined-check' },
      { id: 'joined-nfc-to-joined-check', source: 'joined-nfc', target: 'joined-check' },
    ],
  };
}

function concatenateScalars(left: Uint32Array, right: Uint32Array): Uint32Array {
  const result = new Uint32Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

function requireScalars(value: OperationValue | undefined): Uint32Array {
  if (!value || value.kind !== 'scalars') {
    throw new TypeError('Normalization puzzle operations require Unicode scalar sequences.');
  }
  return value.value;
}
