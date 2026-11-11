import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import * as wasm from '../src/lib/wasm/pkg/unicodd_core.js'
import { createEngine } from '../src/lib/engine'
import type { Program } from '../src/types'
import puzzle from './fixtures/transport.json'
import vectors from './fixtures/unicode-operations.json'

const program = puzzle as Program

let initializations = 0
const engine = createEngine(async () => {
  initializations++
  const binary = await readFile(
    new URL('../src/lib/wasm/pkg/unicodd_core_bg.wasm', import.meta.url),
  )
  await wasm.default({ module_or_path: binary })
  return wasm
})

describe('generated WASM bindings', () => {
  it('initializes once and reports the engine and Unicode versions', async () => {
    const results = await Promise.all([engine.info(), engine.info()])
    expect(results[0]).toEqual({
      ok: true,
      value: {
        version: 1,
        unicodeVersion: '18.0.0',
        caseFoldingVersion: '15.1.0',
        skeletonVersion: '15.1.0',
        uts39Revision: 28,
        recoveryVersion: 1,
        collationProfile: 'icu4x-2.1.1-cldr-48.0-icu-78.1rc-v1',
        casingProfile: 'icu4x-2.1.1-unicode-17.0-icu-78.1rc',
        graphemeVersion: '16.0.0',
        bidiVersion: '16.0.0',
      },
    })
    expect(results[1]).toEqual(results[0])
    expect(initializations).toBe(1)
  })

  it('preserves Unicode input and stable typed trace serialization', async () => {
    const text = 'e\u0301🧪\r\n\0\u200d'
    expect(await engine.validate(program)).toEqual({ ok: true, value: null })
    const result = await engine.evaluate(program, { text }, true)
    expect(result).toMatchObject({
      ok: true,
      value: {
        solved: false,
        checks: [
          { id: 'exact', actual: false, expected: true, passed: false, required: true },
          { id: 'invisible', actual: false, expected: false, passed: true, required: true },
        ],
        trace: expect.arrayContaining([
          { id: 'original', op: 'input', dependencies: [], result: { type: 'text', value: text } },
          {
            id: 'normalized',
            op: 'normalize',
            dependencies: ['original'],
            result: { type: 'text', value: 'é🧪\r\n\0\u200d' },
          },
        ]),
      },
    })
    expect(JSON.stringify(await engine.evaluate(program, { text }, true))).toBe(
      JSON.stringify(result),
    )
    expect(await engine.evaluate(program, { text })).toMatchObject({
      ok: true,
      value: { solved: false },
    })
    expect(await engine.normalize('é', 'NFD')).toEqual({ ok: true, value: 'e\u0301' })
  })

  it('returns schema, type, and input errors from Rust', async () => {
    const invalid = { ...program, version: 2 } as unknown as Program
    expect(await engine.validate(invalid)).toMatchObject({
      ok: false,
      error: { code: 'invalid_program', path: 'version' },
    })
    expect(
      await engine.validate({
        ...program,
        checks: [{ id: 'wrong', node: 'original', expected: true }],
      }),
    ).toMatchObject({ ok: false, error: { code: 'type_mismatch', path: 'checks[0]' } })
    expect(await engine.evaluate(program, {})).toMatchObject({
      ok: false,
      error: { code: 'invalid_input', path: 'inputs.text' },
    })
    const invalidUtf8 = new Uint8Array([0xed, 0xa0, 0x80])
    expect(JSON.parse(wasm.normalize_text(invalidUtf8, 'NFC'))).toMatchObject({
      ok: false,
      error: { code: 'invalid_input', path: 'text' },
    })
    const bytes = new TextEncoder()
    const escapedSurrogate = JSON.stringify({ text: '\ud800' })
    expect(
      JSON.parse(
        wasm.evaluate(bytes.encode(JSON.stringify(program)), bytes.encode(escapedSurrogate), false),
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid_input', path: 'inputs' } })
  })

  it('rejects unpaired surrogates before loading or crossing the module boundary', async () => {
    let loaded = false
    const guard = createEngine(async () => {
      loaded = true
      throw new Error('Unexpected load')
    })
    expect(await guard.evaluate(program, { text: '🧪\ud800' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_input', path: 'inputs.text', offset: 2 },
    })
    expect(
      await guard.validate({
        ...program,
        nodes: [{ id: 'broken', op: 'literal', value: { type: 'text', value: '\udfff' } }],
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_program', offset: 0 } })
    expect(await guard.normalize('x\udfff', 'NFC')).toMatchObject({
      ok: false,
      error: { code: 'invalid_input', path: 'text', offset: 1 },
    })
    expect(loaded).toBe(false)
  })

  it('reports a failed initialization and permits a retry', async () => {
    let first = true
    const retry = createEngine(async () => {
      if (first) {
        first = false
        throw new Error('Initialization failed')
      }
      return wasm
    })
    expect(await retry.info()).toMatchObject({ ok: false, error: { code: 'engine_unavailable' } })
    expect(await retry.info()).toMatchObject({ ok: true })
  })
})

it.each(vectors)(
  'agrees with native Rust for $op($text)',
  async ({ op, text, scalar, expected }) => {
    const graph: Program = {
      version: 1,
      inputs: ['text'],
      nodes: [
        { id: 'raw', op: 'input', input: 'text' },
        ...(scalar === undefined
          ? []
          : [
              {
                id: 'scalar',
                op: 'literal' as const,
                value: { type: 'integer' as const, value: scalar },
              },
            ]),
        {
          id: 'result',
          op: op as 'caseFold' | 'skeleton' | 'remove_code_point',
          args: scalar === undefined ? ['raw'] : ['raw', 'scalar'],
        },
      ],
      checks: [],
    }
    const result = await engine.evaluate(graph, { text }, true)
    expect(result.ok && result.value.trace?.at(-1)?.result).toEqual({
      type: 'text',
      value: expected,
    })
  },
)

it('serializes scalar details and rejects invalid inspection input at the WASM boundary', async () => {
  const result = await engine.inspectScalar('i')
  expect(result).toMatchObject({
    ok: true,
    value: {
      name: 'LATIN SMALL LETTER I',
      script: 'Latin',
      unicodeVersion: '15.1.0',
      confusables: expect.arrayContaining([{ scalar: '\u0456', script: 'Cyrillic' }]),
    },
  })
  expect(await engine.inspectScalar('ii')).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  })
  expect(await engine.inspectScalar('\ud800')).toMatchObject({
    ok: false,
    error: { code: 'invalid_input', offset: 0 },
  })
  expect(JSON.parse(wasm.inspect_scalar(new Uint8Array([0xed, 0xa0, 0x80])))).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  })
})
