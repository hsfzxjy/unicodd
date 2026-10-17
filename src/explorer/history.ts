import { unicodeScalarArraysEqual } from '../unicode';

export interface ExplorerHistory {
  entries: Uint32Array[];
  index: number;
}

export function pushHistory(history: ExplorerHistory, target: Uint32Array): ExplorerHistory {
  if (target.length === 0) return history;
  const current = history.entries[history.index];
  if (current && unicodeScalarArraysEqual(current, target)) return history;

  return {
    entries: [...history.entries.slice(0, history.index + 1), target.slice()],
    index: history.index + 1,
  };
}

export function moveHistory(history: ExplorerHistory, offset: -1 | 1): ExplorerHistory {
  return {
    entries: history.entries,
    index: Math.min(Math.max(history.index + offset, 0), history.entries.length - 1),
  };
}
