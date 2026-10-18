import { describe, expect, it } from 'vitest';
import { loadPuzzleCatalog, parsePuzzleFile, puzzleCatalog } from '../src/puzzles/catalog';

function editablePuzzle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const definition = puzzleCatalog[0]!.definition;
  return {
    runtime: 'nfc-concatenation-boundary',
    ...structuredClone(definition),
    ...overrides,
  };
}

describe('JSON puzzle catalog', () => {
  it('loads and orders every standalone puzzle definition', () => {
    expect(puzzleCatalog).toHaveLength(9);
    expect(puzzleCatalog.map(({ definition }) => definition.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(puzzleCatalog.map(({ runtime }) => runtime)).toEqual(
      puzzleCatalog.map(({ definition }) => definition.id),
    );
  });

  it('accepts another JSON puzzle that reuses a registered runtime contract', () => {
    const entry = parsePuzzleFile(
      editablePuzzle({ id: 'another-normalization-puzzle', number: 10 }),
      'another.json',
    );

    expect(entry.runtime).toBe('nfc-concatenation-boundary');
    expect(entry.definition.id).toBe('another-normalization-puzzle');
    expect(entry.definition.number).toBe(10);
  });

  it('rejects unsupported runtimes and incompatible input contracts', () => {
    expect(() => parsePuzzleFile(editablePuzzle({ runtime: 'run-arbitrary-code' }))).toThrow(
      /Unsupported runtime/,
    );
    expect(() => parsePuzzleFile(editablePuzzle({ inputs: [] }))).toThrow(/at least one input/);
    expect(() =>
      parsePuzzleFile(
        editablePuzzle({
          inputs: [
            {
              id: 'input',
              label: 'Wrong input',
              description: 'Does not match the registered runtime.',
              kind: 'text',
              initialValue: '',
            },
          ],
        }),
      ),
    ).toThrow(/requires inputs left:text, right:text/);
    expect(() => parsePuzzleFile(editablePuzzle({ titel: 'Misspelled title' }))).toThrow(
      /Unknown property “titel”/,
    );
  });

  it('rejects duplicate ids and puzzle numbers across files', () => {
    expect(() =>
      loadPuzzleCatalog({
        'first.json': editablePuzzle(),
        'duplicate-id.json': editablePuzzle({ number: 10 }),
      }),
    ).toThrow(/Duplicate puzzle id/);

    expect(() =>
      loadPuzzleCatalog({
        'first.json': editablePuzzle(),
        'duplicate-number.json': editablePuzzle({ id: 'different-id' }),
      }),
    ).toThrow(/Duplicate puzzle number/);
  });
});
