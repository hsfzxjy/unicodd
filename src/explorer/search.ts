import { isUnicodeScalar, stringToUnicodeScalars } from '../unicode';
import type { CharacterSearchResult, RawNameIndex } from './discoveryTypes';

const resultLimit = 20;

export class UnicodeNameIndex {
  readonly unicodeVersion: string;

  private readonly names: Array<[number, string]>;
  private readonly namesByScalar: Map<number, string>;

  constructor(raw: RawNameIndex) {
    this.unicodeVersion = raw.unicode_version;
    this.names = raw.names;
    this.namesByScalar = new Map(raw.names);
  }

  search(rawQuery: string): CharacterSearchResult[] {
    const query = rawQuery.trim();
    if (!query) return [];

    const results = new Map<string, CharacterSearchResult>();
    const codePoint = parseCodePointQuery(query);
    if (codePoint !== null) {
      addResult(
        results,
        Uint32Array.of(codePoint),
        this.namesByScalar.get(codePoint) ?? null,
        'code-point',
      );
    }

    const direct = directCharacterQuery(query);
    if (direct) {
      const name = direct.length === 1 ? (this.namesByScalar.get(direct[0] ?? -1) ?? null) : null;
      addResult(results, direct, name, 'character');
    }

    if (query.length >= 2 && !/^U\+/i.test(query)) {
      const terms = query.toUpperCase().split(/\s+/).filter(Boolean);
      const matching = this.names
        .filter(([, name]) => terms.every((term) => name.includes(term)))
        .sort(
          (left, right) =>
            scoreName(left[1], terms) - scoreName(right[1], terms) || left[0] - right[0],
        );
      for (const [scalar, name] of matching) {
        addResult(results, Uint32Array.of(scalar), name, 'name');
        if (results.size >= resultLimit) break;
      }
    }

    return [...results.values()].slice(0, resultLimit);
  }
}

function parseCodePointQuery(query: string): number | null {
  const explicit = /^(?:U\+|0X)([0-9A-F]{1,6})$/i.exec(query);
  const plain = /^[0-9A-F]{4,6}$/i.test(query) ? query : null;
  const digits = explicit?.[1] ?? plain;
  if (!digits) return null;
  const scalar = Number.parseInt(digits, 16);
  return isUnicodeScalar(scalar) ? scalar : null;
}

function directCharacterQuery(query: string): Uint32Array | null {
  const characters = Array.from(query);
  if (characters.length !== 1 && /^[\x00-\x7f]+$/.test(query)) return null;
  try {
    return stringToUnicodeScalars(query);
  } catch {
    return null;
  }
}

function scoreName(name: string, terms: string[]): number {
  const phrase = terms.join(' ');
  if (name === phrase) return 0;
  if (name.startsWith(phrase)) return 1;
  return 2;
}

function addResult(
  results: Map<string, CharacterSearchResult>,
  target: Uint32Array,
  name: string | null,
  match: CharacterSearchResult['match'],
): void {
  const key = Array.from(target).join('-');
  if (!results.has(key)) results.set(key, { target, name, match });
}
