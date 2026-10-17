export const UNICODE_ABI_VERSION = 3;

export const normalizationForms = ['NFC', 'NFD', 'NFKC', 'NFKD'] as const;
export type NormalizationForm = (typeof normalizationForms)[number];

export interface UnicodeEngineManifest {
  engineId: string;
  abiVersion: number;
  binary: string;
  dependencies: Record<string, string>;
  operations: Record<string, unknown>;
  limitations: string[];
}

export interface UnicodeWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  unicodd_abi_version: () => number;
  unicodd_alloc: (byteLength: number) => number;
  unicodd_dealloc: (pointer: number, byteLength: number) => void;
  unicodd_case_fold: (
    inputPointer: number,
    inputLength: number,
    outputPointer: number,
    outputCapacity: number,
  ) => bigint;
  unicodd_grapheme_boundaries: (
    inputPointer: number,
    inputLength: number,
    outputPointer: number,
    outputCapacity: number,
  ) => bigint;
  unicodd_name: (scalar: number, outputPointer: number, outputCapacity: number) => bigint;
  unicodd_normalize: (
    form: number,
    inputPointer: number,
    inputLength: number,
    outputPointer: number,
    outputCapacity: number,
  ) => bigint;
}
