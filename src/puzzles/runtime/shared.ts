import type { OperationGraph, OperationNode, OperationValue } from '../../engine/types';
import { formatCodePoint, unicodeScalarArraysEqual } from '../../unicode';
import type {
  PreparedPuzzleInput,
  PuzzleDefinition,
  PuzzleEvaluation,
  PuzzleOperations,
} from '../types';

export function createSources(
  definition: PuzzleDefinition,
  inputs: Readonly<Record<string, PreparedPuzzleInput>>,
): Readonly<Record<string, OperationValue>> {
  return Object.fromEntries(
    definition.inputs.map((input) => {
      const prepared = inputs[input.id];
      return input.kind === 'utf16-units'
        ? [input.id, { kind: 'utf16', value: requireUtf16(prepared) } satisfies OperationValue]
        : [input.id, { kind: 'scalars', value: requireScalars(prepared) } satisfies OperationValue];
    }),
  );
}

export function twoTransformGraph(
  transformLabel: string,
  transform: (input: Uint32Array) => Uint32Array,
  comparisonLabel: string,
  transformExplanation: string,
  comparisonExplanation: string,
): OperationGraph {
  return graph(
    [
      source('left', 'Input A', 'scalars'),
      source('right', 'Input B', 'scalars'),
      scalarOperation(
        'left-result',
        `${transformLabel}(A)`,
        'scalars',
        (input) => ({ kind: 'scalars', value: transform(input) }),
        transformExplanation,
      ),
      scalarOperation(
        'right-result',
        `${transformLabel}(B)`,
        'scalars',
        (input) => ({ kind: 'scalars', value: transform(input) }),
        transformExplanation,
      ),
      {
        id: 'compare',
        label: comparisonLabel,
        explanation: comparisonExplanation,
        inputKinds: ['scalars', 'scalars'],
        outputKind: 'boolean',
        execute: ([left, right]) => ({
          kind: 'boolean',
          value: unicodeScalarArraysEqual(requireScalarsValue(left), requireScalarsValue(right)),
        }),
      },
    ],
    [
      edge('left', 'left-result'),
      edge('right', 'right-result'),
      edge('left-result', 'compare'),
      edge('right-result', 'compare'),
    ],
  );
}

export function graph(nodes: OperationNode[], edges: OperationGraph['edges']): OperationGraph {
  return { nodes, edges };
}

export function source(
  id: string,
  label: string,
  outputKind: OperationNode['outputKind'],
): OperationNode {
  return {
    id,
    label,
    explanation: `Supplies ${label.toLowerCase()} to the graph as ${outputKind}.`,
    inputKinds: [],
    outputKind,
  };
}

export function unary(
  id: string,
  label: string,
  inputKind: OperationNode['outputKind'],
  outputKind: OperationNode['outputKind'],
  execute: NonNullable<OperationNode['execute']>,
  outputUnit?: string,
  explanation = `Transforms ${inputKind} input into ${outputKind} output.`,
): OperationNode {
  return { id, label, explanation, inputKinds: [inputKind], outputKind, outputUnit, execute };
}

export function scalarOperation(
  id: string,
  label: string,
  outputKind: OperationNode['outputKind'],
  execute: (input: Uint32Array) => OperationValue,
  explanation?: string,
): OperationNode {
  return unary(
    id,
    label,
    'scalars',
    outputKind,
    ([input]) => execute(requireScalarsValue(input)),
    undefined,
    explanation,
  );
}

export function scalarCountNode(id: string): OperationNode {
  return unary(
    id,
    'Scalar count',
    'scalars',
    'count',
    ([input]) => ({ kind: 'count', value: requireScalarsValue(input).length }),
    'scalars',
    'Counts Unicode scalar values. This differs from byte, UTF-16 code-unit, and grapheme-cluster length.',
  );
}

export function edge(sourceId: string, target: string): OperationGraph['edges'][number] {
  return { id: `${sourceId}-to-${target}`, source: sourceId, target };
}

export function evaluation(
  success: boolean,
  preview: string,
  code: string,
  checks: PuzzleEvaluation['checks'],
  inputStatuses: PuzzleEvaluation['inputStatuses'],
  details: PuzzleEvaluation['details'],
): PuzzleEvaluation {
  return {
    success,
    preview,
    code,
    status: success ? 'Target reached' : 'Keep exploring',
    checks,
    inputStatuses,
    details,
  };
}

export function check(label: string, value: string, passed: boolean) {
  return { label, value, passed };
}

export function status(passed: boolean, label: string) {
  return { passed, label };
}

export function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

export function formatScalars(value: Uint32Array): string {
  return value.length ? Array.from(value, formatCodePoint).join(' ') : 'Empty sequence';
}

export function graphemeCount(input: Uint32Array, operations: PuzzleOperations): number {
  return Math.max(operations.graphemeBoundaries(input).length - 1, 0);
}

export function requireScalars(input: PreparedPuzzleInput | undefined): Uint32Array {
  if (!input?.scalars) throw new TypeError('Puzzle input is not a valid Unicode scalar sequence.');
  return input.scalars;
}

export function requireUtf16(input: PreparedPuzzleInput | undefined): Uint16Array {
  if (!input?.utf16) throw new TypeError('Puzzle input is not a valid UTF-16 code-unit sequence.');
  return input.utf16;
}

export function requireScalarsValue(input: OperationValue | undefined): Uint32Array {
  if (!input || input.kind !== 'scalars') throw new TypeError('Operation requires scalar input.');
  return input.value;
}

export function requireBytes(input: OperationValue | undefined): Uint8Array {
  if (!input || input.kind !== 'bytes') throw new TypeError('Operation requires byte input.');
  return input.value;
}

export function requireUtf16Value(input: OperationValue | undefined): Uint16Array {
  if (!input || input.kind !== 'utf16') throw new TypeError('Operation requires UTF-16 input.');
  return input.value;
}

export function requireHistoricalNormalizer(
  operations: PuzzleOperations,
): NonNullable<PuzzleOperations['normalizeHistorical']> {
  if (!operations.normalizeHistorical) {
    throw new Error('The historical normalization engine is not loaded.');
  }
  return operations.normalizeHistorical;
}

export function requireConfusableSkeleton(
  operations: PuzzleOperations,
): NonNullable<PuzzleOperations['confusableSkeleton']> {
  if (!operations.confusableSkeleton) {
    throw new Error('This puzzle requires the Unicode confusable index.');
  }
  return operations.confusableSkeleton;
}

export function requireGeneralCategory(
  operations: PuzzleOperations,
): NonNullable<PuzzleOperations['generalCategory']> {
  if (!operations.generalCategory) {
    throw new Error('This puzzle requires the Unicode property index.');
  }
  return operations.generalCategory;
}
