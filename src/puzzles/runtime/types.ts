import type { OperationGraph } from '../../engine/types';
import type { PreparedPuzzleInput, PuzzleEvaluation, PuzzleOperations } from '../types';

export interface PuzzleRuntimeImplementation {
  evaluate: (
    inputs: Readonly<Record<string, PreparedPuzzleInput>>,
    operations: PuzzleOperations,
  ) => PuzzleEvaluation;
  createGraph: (operations: PuzzleOperations) => OperationGraph;
}
