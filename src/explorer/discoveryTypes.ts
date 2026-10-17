export interface CharacterProperties {
  generalCategory: string;
  canonicalCombiningClass: number;
  script: string;
  age: string;
}

export type RelationshipKind =
  | 'canonical'
  | 'compatibility'
  | 'uppercase'
  | 'lowercase'
  | 'titlecase'
  | 'case-fold'
  | 'confusable';

export interface CharacterRelationship {
  kind: RelationshipKind;
  label: string;
  detail: string;
  target: Uint32Array;
  name: string | null;
}

export interface RelationshipGroup {
  id: 'canonical' | 'compatibility' | 'case' | 'confusable';
  title: string;
  description: string;
  results: CharacterRelationship[];
  total: number;
}

export interface CharacterSearchResult {
  target: Uint32Array;
  name: string | null;
  match: 'character' | 'code-point' | 'name';
}

export interface DiscoveryManifest {
  unicodeVersion: string;
  uts39Version: string;
  relationships: string;
  names: string;
}

export interface RawRelationshipRecord {
  cp: number;
  nfd?: number[];
  nfkd?: number[];
  upper?: number;
  lower?: number;
  title?: number;
  fold?: number[];
}

export interface RawSequenceMapping {
  source: number[];
  target: number[];
}

export type RawPropertyRange = [
  start: number,
  end: number,
  generalCategory: string,
  canonicalCombiningClass: number,
  script: string,
  age: string,
];

export interface RawRelationshipIndex {
  unicode_version: string;
  uts39_version: string;
  properties: RawPropertyRange[];
  records: RawRelationshipRecord[];
  confusables: RawSequenceMapping[];
}

export interface RawNameIndex {
  unicode_version: string;
  names: Array<[number, string]>;
}
