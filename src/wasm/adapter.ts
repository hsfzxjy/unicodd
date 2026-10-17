import { isUnicodeScalar } from '../unicode';
import { UNICODE_ABI_VERSION, type NormalizationForm, type UnicodeWasmExports } from './types';

const formIds: Record<NormalizationForm, number> = {
  NFC: 1,
  NFD: 2,
  NFKC: 3,
  NFKD: 4,
};

const statusNames = [
  'success',
  'insufficient capacity',
  'invalid operation',
  'invalid Unicode scalar',
  'invalid pointer',
  'misaligned pointer',
  'length overflow',
  'allocation failed',
  'internal error',
] as const;

interface AbiResult {
  status: number;
  detail: number;
}

export class WasmOperationError extends Error {
  constructor(
    readonly status: number,
    readonly detail: number,
  ) {
    super(`WASM operation failed: ${statusNames[status] ?? `status ${status}`} (${detail}).`);
    this.name = 'WasmOperationError';
  }
}

export class UnicodeWasmAdapter {
  private readonly exports: UnicodeWasmExports;

  constructor(instance: WebAssembly.Instance) {
    this.exports = validateExports(instance.exports);
    const abiVersion = this.exports.unicodd_abi_version();
    if (abiVersion !== UNICODE_ABI_VERSION) {
      throw new Error(
        `Unsupported Unicode WASM ABI ${abiVersion}; expected ${UNICODE_ABI_VERSION}.`,
      );
    }
  }

  get abiVersion(): number {
    return this.exports.unicodd_abi_version();
  }

  normalize(form: NormalizationForm, input: Uint32Array): Uint32Array {
    for (const [index, scalar] of input.entries()) {
      if (!isUnicodeScalar(scalar)) {
        throw new RangeError(`Invalid Unicode scalar value at scalar offset ${index}.`);
      }
    }

    const inputByteLength = checkedByteLength(input.length);
    const inputPointer = this.allocate(inputByteLength);
    let outputPointer = 0;
    let outputByteLength = 0;

    try {
      if (input.length > 0) {
        new Uint32Array(this.exports.memory.buffer, inputPointer, input.length).set(input);
      }

      const query = unpackResult(
        this.exports.unicodd_normalize(formIds[form], inputPointer, input.length, 0, 0),
      );
      if (query.status !== 0 && query.status !== 1) throwResult(query);
      const required = query.detail;
      if (required === 0) return new Uint32Array();

      outputByteLength = checkedByteLength(required);
      outputPointer = this.allocate(outputByteLength);
      const result = unpackResult(
        this.exports.unicodd_normalize(
          formIds[form],
          inputPointer,
          input.length,
          outputPointer,
          required,
        ),
      );
      if (result.status !== 0) throwResult(result);
      if (result.detail !== required) {
        throw new Error(`WASM wrote ${result.detail} scalars after reporting ${required}.`);
      }

      return new Uint32Array(new Uint32Array(this.exports.memory.buffer, outputPointer, required));
    } finally {
      if (outputPointer !== 0) this.exports.unicodd_dealloc(outputPointer, outputByteLength);
      if (inputPointer !== 0) this.exports.unicodd_dealloc(inputPointer, inputByteLength);
    }
  }

  private allocate(byteLength: number): number {
    if (byteLength === 0) return 0;
    const pointer = this.exports.unicodd_alloc(byteLength);
    if (pointer === 0) throw new WasmOperationError(7, byteLength);
    return pointer;
  }
}

function checkedByteLength(scalarLength: number): number {
  const byteLength = scalarLength * Uint32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(byteLength) || byteLength > 0xffffffff) {
    throw new RangeError('Scalar sequence is too large for the WASM ABI.');
  }
  return byteLength;
}

function unpackResult(packed: bigint): AbiResult {
  return {
    status: Number((packed >> 32n) & 0xffffffffn),
    detail: Number(packed & 0xffffffffn),
  };
}

function throwResult(result: AbiResult): never {
  throw new WasmOperationError(result.status, result.detail);
}

function validateExports(exports: WebAssembly.Exports): UnicodeWasmExports {
  const candidate = exports as Partial<UnicodeWasmExports>;
  const functionNames = [
    'unicodd_abi_version',
    'unicodd_alloc',
    'unicodd_dealloc',
    'unicodd_normalize',
  ] as const;

  if (!(candidate.memory instanceof WebAssembly.Memory)) {
    throw new TypeError('Unicode WASM module does not export memory.');
  }
  for (const name of functionNames) {
    if (typeof candidate[name] !== 'function') {
      throw new TypeError(`Unicode WASM module does not export ${name}.`);
    }
  }

  return candidate as UnicodeWasmExports;
}
