export interface TextSelection {
  start: number;
  end: number;
}

export interface GraphemeRange {
  index: number;
  scalarStart: number;
  scalarEnd: number;
  utf16Start: number;
  utf16End: number;
  scalars: Uint32Array;
}

export type EditorAction = 'insert' | 'replace' | 'append';

export interface TextEditResult {
  text: string;
  selection: TextSelection;
}
