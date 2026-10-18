import { describe, expect, it } from 'vitest';
import { puzzleHref, puzzleIndexFromSearch } from '../src/puzzles/navigation';
import type { PuzzleDefinition } from '../src/puzzles/types';

const definitions = [{ id: 'first' }, { id: 'second' }, { id: 'third' }] as PuzzleDefinition[];

describe('puzzle URL navigation', () => {
  it('selects a puzzle by stable ID and safely falls back', () => {
    expect(puzzleIndexFromSearch('?puzzle=second', definitions)).toBe(1);
    expect(puzzleIndexFromSearch('?puzzle=missing', definitions)).toBe(0);
    expect(puzzleIndexFromSearch('', definitions)).toBe(0);
  });

  it('preserves the hosting path, other parameters, and hash', () => {
    expect(puzzleHref('https://example.test/unicodd/?mode=demo#graph', 'second')).toBe(
      '/unicodd/?mode=demo&puzzle=second#graph',
    );
  });
});
