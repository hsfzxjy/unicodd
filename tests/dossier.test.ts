import { expect, it } from 'vitest'
import { actionCommand, commandDraft, composerAction, parseCommand } from '../src/lib/commands'
import { engine } from './scenario-content'

const dataset = {
  version: 1,
  revision: 'sample',
  query: 'île',
  approvedFields: ['text'],
  records: [
    { id: 'one', eligible: true, fields: { text: '🧪 l’i\u0302le puis ÎLE', notes: '' } },
    { id: 'two', eligible: false, fields: { text: 'îles', notes: 'île' } },
  ],
}

it('reconciles word boundaries and offsets against immutable UTF-8 source fields', async () => {
  const result = await engine.runDossier({
    version: 1,
    dataset,
    command: 'search',
    args: ['ÎLE', 'fr/nfc/fold', 'approved'],
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  const contexts = result.value.rows.flatMap(({ source }) => (source ? [source] : []))
  expect(contexts.map(({ hit }) => hit)).toEqual(['i\u0302le', 'ÎLE'])
  const text = dataset.records[0].fields.text
  for (const { hit, coordinates } of contexts) {
    expect(text.slice(...coordinates.utf16)).toBe(hit)
    expect(
      new TextDecoder().decode(new TextEncoder().encode(text).slice(...coordinates.utf8)),
    ).toBe(hit)
    expect([...text].slice(...coordinates.scalars).join('')).toBe(hit)
  }
  expect(contexts[0].coordinates).toMatchObject({
    utf8: [9, 14],
    utf16: [5, 9],
    scalars: [4, 8],
    graphemes: [4, 7],
    exactGraphemes: true,
  })
})

it('rejects malformed UTF-16 before search transport', async () => {
  await expect(
    engine.runDossier({
      version: 1,
      dataset,
      command: 'search',
      args: ['🧪\udfff', 'default/raw/exact', 'approved'],
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: 'invalid_input', path: 'args.0', offset: 2 },
  })
})

it('preserves JSON escape syntax through structured and quoted command editing', async () => {
  const raw = String.raw`{"value":"\uD83D\uDCE8","escape":"\\u00C9"}`
  const action = composerAction('json-check', [raw], [])
  const quoted = actionCommand(action)!
  expect(parseCommand(quoted)).toEqual(action)
  expect(commandDraft(quoted)?.values).toEqual([raw])
  const result = await engine.runDossier({
    version: 1,
    dataset,
    command: 'json-check',
    args: [raw],
  })
  expect(result.ok && result.value.rows[0]?.serialized).toBe(
    String.raw`{"escape":"\\u00C9","value":"📨"}`,
  )
})

it.each([String.raw`{"x":"\uDEAD"}`, String.raw`{"x":"first","\u0078":"second"}`])(
  'rejects non-interoperable interchange %s',
  async (raw) => {
    await expect(
      engine.runDossier({ version: 1, dataset, command: 'json-check', args: [raw] }),
    ).resolves.toMatchObject({
      ok: true,
      value: { solved: false, checks: [{ id: 'json', passed: false }] },
    })
  },
)

it('reports target-specific path parsing and rejects newly created separators', async () => {
  const probe = (target: string, transform: string, path: string) =>
    engine.runDossier({
      version: 1,
      dataset,
      command: 'probe-path',
      args: [target, transform, path],
    })
  await expect(probe('posix-cs', 'raw', 'notes／sample.txt')).resolves.toMatchObject({
    ok: true,
    value: { solved: true },
  })
  await expect(probe('posix-cs', 'nfkc', 'notes／sample.txt')).resolves.toMatchObject({
    ok: true,
    value: { solved: false, rows: [{ label: 'posix-cs' }, { fields: ['structural-change'] }] },
  })
  await expect(probe('win32-compat', 'raw', 'samples/COM¹.txt')).resolves.toMatchObject({
    ok: true,
    value: { solved: false, rows: [{ label: 'win32-compat' }, { fields: ['device-name'] }] },
  })
})
