export interface PuzzleInputDefinition {
  id: 'left' | 'right';
  label: string;
  description: string;
  initialValue: string;
}

export interface PuzzleDefinition {
  id: string;
  title: string;
  objective: string;
  defaultUnicodeProfile: string;
  inputs: readonly PuzzleInputDefinition[];
  hints: readonly string[];
  explanation: string;
}

export interface NormalizationPuzzleEvaluation {
  leftNormalized: Uint32Array;
  rightNormalized: Uint32Array;
  joined: Uint32Array;
  joinedNormalized: Uint32Array;
  leftIsNfc: boolean;
  rightIsNfc: boolean;
  joinedIsNfc: boolean;
  success: boolean;
}

export type NormalizeNfc = (input: Uint32Array) => Uint32Array;
