import { formatCodePoint, unicodeScalarArraysEqual } from '../unicode';
import type {
  CharacterProperties,
  CharacterRelationship,
  RawRelationshipIndex,
  RawRelationshipRecord,
  RawSequenceMapping,
  RelationshipGroup,
  RelationshipKind,
} from './discoveryTypes';

const resultLimit = 8;

export type NormalizeNfd = (input: Uint32Array) => Uint32Array;
export type NameScalars = (input: Uint32Array) => string | null;

export class UnicodeRelationshipIndex {
  readonly unicodeVersion: string;
  readonly uts39Version: string;

  private readonly records = new Map<number, RawRelationshipRecord>();
  private readonly properties: RawRelationshipIndex['properties'];
  private readonly canonicalExact = new Map<string, number[]>();
  private readonly canonicalBase = new Map<number, number[]>();
  private readonly compatibilityExact = new Map<string, number[]>();
  private readonly foldReverse = new Map<string, number[]>();
  private readonly confusableByFirst = new Map<number, RawSequenceMapping[]>();
  private readonly confusableReverse = new Map<string, number[][]>();

  constructor(raw: RawRelationshipIndex) {
    this.unicodeVersion = raw.unicode_version;
    this.uts39Version = raw.uts39_version;
    this.properties = raw.properties;
    for (const record of raw.records) {
      this.records.set(record.cp, record);
      if (record.nfd?.length) {
        append(this.canonicalExact, sequenceKey(record.nfd), record.cp);
        append(this.canonicalBase, record.nfd[0], record.cp);
      }
      if (record.nfkd?.length) {
        append(this.compatibilityExact, sequenceKey(record.nfkd), record.cp);
      }
      if (record.fold?.length) append(this.foldReverse, sequenceKey(record.fold), record.cp);
    }

    for (const mapping of raw.confusables) {
      const first = mapping.source[0];
      if (first === undefined) continue;
      const candidates = this.confusableByFirst.get(first) ?? [];
      candidates.push(mapping);
      this.confusableByFirst.set(first, candidates);
      appendSequence(this.confusableReverse, sequenceKey(mapping.target), mapping.source);
    }
    for (const mappings of this.confusableByFirst.values()) {
      mappings.sort((left, right) => right.source.length - left.source.length);
    }
  }

  propertiesFor(scalar: number): CharacterProperties | null {
    let low = 0;
    let high = this.properties.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const range = this.properties[middle];
      if (!range) return null;
      if (scalar < range[0]) high = middle - 1;
      else if (scalar > range[1]) low = middle + 1;
      else {
        return {
          generalCategory: range[2],
          canonicalCombiningClass: range[3],
          script: range[4],
          age: range[5],
        };
      }
    }
    return null;
  }

  relationships(
    target: Uint32Array,
    normalizeNfd: NormalizeNfd,
    nameScalars: NameScalars,
  ): RelationshipGroup[] {
    if (target.length === 0) return [];
    const normalized = normalizeNfd(target);
    const canonical = new Map<string, CharacterRelationship>();
    const canonicalExact = this.canonicalExact.get(sequenceKey(normalized)) ?? [];
    for (const scalar of canonicalExact) {
      addRelationship(
        canonical,
        target,
        Uint32Array.of(scalar),
        'canonical',
        'Canonical equivalent',
        `NFD is ${formatSequence(normalized)}.`,
        nameScalars,
      );
    }
    if (target.length === 1) {
      for (const scalar of this.canonicalBase.get(target[0] ?? -1) ?? []) {
        const decomposition = this.records.get(scalar)?.nfd ?? [];
        addRelationship(
          canonical,
          target,
          Uint32Array.of(scalar),
          'canonical',
          'Shared canonical base',
          `Canonical decomposition begins with ${formatCodePoint(target[0] ?? 0)}: ${formatSequence(decomposition)}.`,
          nameScalars,
        );
      }
    }

    const compatibility = new Map<string, CharacterRelationship>();
    for (const scalar of this.compatibilityExact.get(sequenceKey(normalized)) ?? []) {
      addRelationship(
        compatibility,
        target,
        Uint32Array.of(scalar),
        'compatibility',
        'Compatibility relative',
        `NFKD is ${formatSequence(normalized)}.`,
        nameScalars,
      );
    }

    const casing = new Map<string, CharacterRelationship>();
    if (target.length === 1) {
      const record = this.records.get(target[0] ?? -1);
      addCaseMapping(casing, target, record?.upper, 'uppercase', 'Simple uppercase', nameScalars);
      addCaseMapping(casing, target, record?.lower, 'lowercase', 'Simple lowercase', nameScalars);
      addCaseMapping(casing, target, record?.title, 'titlecase', 'Simple titlecase', nameScalars);
      if (record?.fold?.length) {
        addRelationship(
          casing,
          target,
          Uint32Array.from(record.fold),
          'case-fold',
          'Default case fold',
          `Case-fold mapping is ${formatSequence(record.fold)}.`,
          nameScalars,
        );
      }
    }
    const folded = this.caseFold(target);
    for (const scalar of this.foldReverse.get(sequenceKey(folded)) ?? []) {
      addRelationship(
        casing,
        target,
        Uint32Array.of(scalar),
        'case-fold',
        'Same case-fold result',
        `Default case fold is ${formatSequence(folded)}.`,
        nameScalars,
      );
    }

    const confusable = new Map<string, CharacterRelationship>();
    const skeleton = this.confusableSkeleton(target, normalizeNfd);
    for (const source of this.confusableReverse.get(sequenceKey(skeleton)) ?? []) {
      addRelationship(
        confusable,
        target,
        Uint32Array.from(source),
        'confusable',
        'Same UTS #39 skeleton',
        `Confusable skeleton is ${formatSequence(skeleton)}. Appearance depends on the font.`,
        nameScalars,
      );
    }

    return [
      makeGroup(
        'canonical',
        'Canonical relatives',
        'Characters related through canonical decomposition. These are normalization relationships.',
        canonical,
      ),
      makeGroup(
        'compatibility',
        'Compatibility relatives',
        'Characters whose compatibility decomposition reaches this sequence.',
        compatibility,
      ),
      makeGroup(
        'case',
        'Case relationships',
        'Simple case mappings and default Unicode case-fold relationships.',
        casing,
      ),
      makeGroup(
        'confusable',
        'Visual confusables',
        'UTS #39 skeleton matches are security signals, not normalization or semantic equivalence.',
        confusable,
      ),
    ];
  }

  private caseFold(input: Uint32Array): Uint32Array {
    const output: number[] = [];
    for (const scalar of input) {
      const mapping = this.records.get(scalar)?.fold;
      output.push(...(mapping?.length ? mapping : [scalar]));
    }
    return Uint32Array.from(output);
  }

  confusableSkeleton(input: Uint32Array, normalizeNfd: NormalizeNfd): Uint32Array {
    const normalized = normalizeNfd(input);
    const output: number[] = [];
    for (let index = 0; index < normalized.length;) {
      const candidates = this.confusableByFirst.get(normalized[index] ?? -1) ?? [];
      const mapping = candidates.find((candidate) =>
        sequenceMatches(normalized, index, candidate.source),
      );
      if (mapping) {
        output.push(...mapping.target);
        index += mapping.source.length;
      } else {
        output.push(normalized[index] ?? 0);
        index += 1;
      }
    }
    return normalizeNfd(Uint32Array.from(output));
  }
}

function makeGroup(
  id: RelationshipGroup['id'],
  title: string,
  description: string,
  values: Map<string, CharacterRelationship>,
): RelationshipGroup {
  const results = [...values.values()].sort(compareRelationships);
  return { id, title, description, total: results.length, results: results.slice(0, resultLimit) };
}

function addCaseMapping(
  results: Map<string, CharacterRelationship>,
  current: Uint32Array,
  scalar: number | undefined,
  kind: RelationshipKind,
  label: string,
  nameScalars: NameScalars,
): void {
  if (scalar === undefined) return;
  addRelationship(
    results,
    current,
    Uint32Array.of(scalar),
    kind,
    label,
    `${label} maps to ${formatCodePoint(scalar)}.`,
    nameScalars,
  );
}

function addRelationship(
  results: Map<string, CharacterRelationship>,
  current: Uint32Array,
  target: Uint32Array,
  kind: RelationshipKind,
  label: string,
  detail: string,
  nameScalars: NameScalars,
): void {
  if (unicodeScalarArraysEqual(current, target)) return;
  const key = sequenceKey(target);
  if (results.has(key)) return;
  results.set(key, { kind, label, detail, target, name: nameScalars(target) });
}

function append<Key>(map: Map<Key, number[]>, key: Key, value: number): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function appendSequence(map: Map<string, number[][]>, key: string, value: number[]): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function sequenceKey(value: ArrayLike<number>): string {
  return Array.from(value).join('-');
}

function sequenceMatches(input: Uint32Array, offset: number, expected: number[]): boolean {
  if (offset + expected.length > input.length) return false;
  return expected.every((scalar, index) => input[offset + index] === scalar);
}

function formatSequence(value: ArrayLike<number>): string {
  return Array.from(value, formatCodePoint).join(' + ');
}

function compareRelationships(left: CharacterRelationship, right: CharacterRelationship): number {
  return (
    left.target.length - right.target.length ||
    (left.target[0] ?? 0) - (right.target[0] ?? 0) ||
    sequenceKey(left.target).localeCompare(sequenceKey(right.target))
  );
}
