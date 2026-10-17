export type ValueKind = 'scalars' | 'bytes' | 'utf16' | 'count' | 'boolean';

export type OperationValue =
  | { kind: 'scalars'; value: Uint32Array }
  | { kind: 'bytes'; value: Uint8Array }
  | { kind: 'utf16'; value: Uint16Array }
  | { kind: 'count'; value: number }
  | { kind: 'boolean'; value: boolean };

export interface OperationNode {
  id: string;
  label: string;
  inputKinds: readonly ValueKind[];
  outputKind: ValueKind;
  outputUnit?: string;
  execute?: (inputs: readonly OperationValue[]) => OperationValue;
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
