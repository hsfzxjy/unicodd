import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RawNameIndex, RawRelationshipIndex } from '../src/explorer/discoveryTypes';
import { UnicodeRelationshipIndex } from '../src/explorer/relationships';
import { UnicodeNameIndex } from '../src/explorer/search';
import { stringToUnicodeScalars } from '../src/unicode';
import type { UnicodeWasmAdapter } from '../src/wasm/adapter';
import { instantiateUnicodeEngine } from '../src/wasm/loader';

describe('Unicode discovery indexes', () => {
  let adapter: UnicodeWasmAdapter;
  let relationships: UnicodeRelationshipIndex;
  let names: UnicodeNameIndex;

  beforeAll(async () => {
    const [wasm, relationshipJson, nameJson] = await Promise.all([
      readFile(new URL('../public/wasm/unicodd_ops_core.wasm', import.meta.url)),
      readFile(
        new URL('../public/unicode-indexes/relationships-17.0.0.json', import.meta.url),
        'utf8',
      ),
      readFile(new URL('../public/unicode-indexes/names-17.0.0.json', import.meta.url), 'utf8'),
    ]);
    adapter = await instantiateUnicodeEngine(wasm);
    relationships = new UnicodeRelationshipIndex(
      JSON.parse(relationshipJson) as RawRelationshipIndex,
    );
    names = new UnicodeNameIndex(JSON.parse(nameJson) as RawNameIndex);
  });

  function discover(value: string) {
    return relationships.relationships(
      stringToUnicodeScalars(value),
      (input) => adapter.normalize('NFD', input),
      (input) =>
        Array.from(input, (scalar) => adapter.name(scalar) ?? 'UNNAMED').join(' + ') || null,
    );
  }

  it('returns versioned category, script, age, and combining-class properties', () => {
    expect(relationships.unicodeVersion).toBe('17.0.0');
    expect(relationships.uts39Version).toBe('17.0.0');
    expect(relationships.propertiesFor(0x65)).toEqual({
      generalCategory: 'Ll',
      canonicalCombiningClass: 0,
      script: 'Latin',
      age: '1.1',
    });
    expect(relationships.propertiesFor(0x301)?.canonicalCombiningClass).toBe(230);
  });

  it('finds characters sharing a canonical decomposition base', () => {
    const canonical = discover('e').find(({ id }) => id === 'canonical');
    expect(canonical?.results.some(({ target }) => target[0] === 0xe9)).toBe(true);
    expect(canonical?.results.every(({ kind }) => kind === 'canonical')).toBe(true);
  });

  it('keeps compatibility and case relationships explicitly separate', () => {
    const digitGroups = discover('1');
    const compatibility = digitGroups.find(({ id }) => id === 'compatibility');
    expect(compatibility?.results.some(({ target }) => target[0] === 0x2460)).toBe(true);

    const caseGroup = discover('a').find(({ id }) => id === 'case');
    expect(caseGroup?.results.some(({ target }) => target[0] === 0x41)).toBe(true);
  });

  it('finds UTS #39 confusables by their skeleton without calling them equivalent', () => {
    const confusables = discover('a').find(({ id }) => id === 'confusable');
    expect(confusables?.results.some(({ target }) => target[0] === 0x430)).toBe(true);
    expect(confusables?.description).toContain('not normalization or semantic equivalence');

    const sequenceConfusables = discover('rn').find(({ id }) => id === 'confusable');
    expect(sequenceConfusables?.results.some(({ target }) => target[0] === 0x6d)).toBe(true);
  });

  it('searches direct characters, code points, and Unicode names', () => {
    expect(names.unicodeVersion).toBe('17.0.0');
    expect(names.search('🧩')[0]).toMatchObject({
      name: 'JIGSAW PUZZLE PIECE',
      match: 'character',
    });
    expect(names.search('U+2460')[0]).toMatchObject({
      name: 'CIRCLED DIGIT ONE',
      match: 'code-point',
    });
    expect(names.search('circled digit one')[0]).toMatchObject({
      name: 'CIRCLED DIGIT ONE',
      match: 'name',
    });
    expect(names.search('')).toEqual([]);
  });
});
