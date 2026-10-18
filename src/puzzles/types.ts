export interface PuzzleInputDefinition {
  id: string;
  label: string;
  description: string;
  kind: 'text' | 'utf16-units';
  placeholder?: string;
  initialValue: string;
}

export interface PuzzleReference {
  label: string;
  url: string;
}

export interface PuzzleDefinition {
  id: string;
  number: number;
  theme: string;
  title: string;
  objective: string;
  defaultUnicodeProfile: string;
  inputs: readonly PuzzleInputDefinition[];
  graphTitle: string;
  graphDescription: string;
  resultLabel: string;
  hints: readonly string[];
  explanation: string;
  references: readonly PuzzleReference[];
  capabilities: readonly PuzzleCapability[];
  historicalUnicodeProfile?: string;
}

export type PuzzleCapability =
  | 'normalization'
  | 'case-folding'
  | 'grapheme-segmentation'
  | 'confusable-index'
  | 'property-index'
  | 'historical-normalization';

export interface PreparedPuzzleInput {
  definition: PuzzleInputDefinition;
  raw: string;
  scalars: Uint32Array | null;
  utf16: Uint16Array | null;
  error: string | null;
}

export interface PuzzleCheck {
  label: string;
  value: string;
  passed: boolean;
}

export interface PuzzleInputStatus {
  label: string;
  passed: boolean;
}

export interface PuzzleEvaluation {
  success: boolean;
  preview: string;
  code: string;
  status: string;
  checks: PuzzleCheck[];
  inputStatuses: Record<string, PuzzleInputStatus>;
  details: Array<{ label: string; value: string }>;
}

export interface PuzzleOperations {
  normalize: (form: 'NFC' | 'NFD' | 'NFKC' | 'NFKD', input: Uint32Array) => Uint32Array;
  caseFold: (input: Uint32Array) => Uint32Array;
  graphemeBoundaries: (input: Uint32Array) => Uint32Array;
  confusableSkeleton?: (input: Uint32Array) => Uint32Array;
  generalCategory?: (scalar: number) => string | null;
  normalizeHistorical?: (form: 'NFC' | 'NFD' | 'NFKC' | 'NFKD', input: Uint32Array) => Uint32Array;
}

export interface PuzzleRuntime {
  definition: PuzzleDefinition;
  evaluate: (
    inputs: Readonly<Record<string, PreparedPuzzleInput>>,
    operations: PuzzleOperations,
  ) => PuzzleEvaluation;
  createGraph: (operations: PuzzleOperations) => import('../engine/types').OperationGraph;
  createSources: (
    inputs: Readonly<Record<string, PreparedPuzzleInput>>,
  ) => Readonly<Record<string, import('../engine/types').OperationValue>>;
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
