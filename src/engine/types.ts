export type ValueKind = 'scalars' | 'bytes' | 'utf16' | 'count';

export type OperationValue =
  | { kind: 'scalars'; value: Uint32Array }
  | { kind: 'bytes'; value: Uint8Array }
  | { kind: 'utf16'; value: Uint16Array }
  | { kind: 'count'; value: number };

export interface OperationNode {
  id: string;
  label: string;
  inputKind: ValueKind | null;
  outputKind: ValueKind;
  execute?: (input: OperationValue) => OperationValue;
}

export interface OperationEdge {
  id: string;
  source: string;
  target: string;
}

export interface OperationGraph {
  nodes: OperationNode[];
  edges: OperationEdge[];
}

export interface ExecutionTrace {
  outputs: Map<string, OperationValue>;
  order: string[];
}
