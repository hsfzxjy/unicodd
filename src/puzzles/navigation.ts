import type { PuzzleDefinition } from './types';

const puzzleParameter = 'puzzle';

export function puzzleIndexFromSearch(
  search: string,
  definitions: readonly PuzzleDefinition[],
): number {
  const requestedId = new URLSearchParams(search).get(puzzleParameter);
  const index = definitions.findIndex(({ id }) => id === requestedId);
  return index >= 0 ? index : 0;
}

export function puzzleHref(currentHref: string, puzzleId: string): string {
  const url = new URL(currentHref);
  url.searchParams.set(puzzleParameter, puzzleId);
  return `${url.pathname}${url.search}${url.hash}`;
}
