import type { OperationGraph, OperationValue } from '../engine/types';
import { unicodeScalarArraysEqual } from '../unicode';
import type { NormalizationPuzzleEvaluation, NormalizeNfc } from './types';

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
      {
        id: 'left',
        label: 'Input A',
        explanation: 'Supplies the first entered string as an exact sequence of Unicode scalars.',
        inputKinds: [],
        outputKind: 'scalars',
      },
      {
        id: 'right',
        label: 'Input B',
        explanation: 'Supplies the second entered string as an exact sequence of Unicode scalars.',
        inputKinds: [],
        outputKind: 'scalars',
      },
      {
        id: 'left-nfc',
        label: 'NFC(A)',
        explanation:
          'Normalizes Input A to canonical composition form (NFC) using the active Unicode engine.',
        inputKinds: ['scalars'],
        outputKind: 'scalars',
        execute: normalizeOperation,
      },
      {
        id: 'right-nfc',
        label: 'NFC(B)',
        explanation:
          'Normalizes Input B to canonical composition form (NFC) using the active Unicode engine.',
        inputKinds: ['scalars'],
        outputKind: 'scalars',
        execute: normalizeOperation,
      },
      {
        id: 'join',
        label: 'Concatenate A + B',
        explanation:
          'Places the exact scalar sequence of Input B after Input A without normalizing either side.',
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
        explanation:
          'Normalizes the concatenated scalar sequence to NFC so boundary composition becomes visible.',
        inputKinds: ['scalars'],
        outputKind: 'scalars',
        execute: normalizeOperation,
      },
      {
        id: 'joined-check',
        label: 'A + B is NFC',
        explanation:
          'Compares the concatenated input with its NFC result. Equal sequences mean the join was already NFC-normalized.',
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
