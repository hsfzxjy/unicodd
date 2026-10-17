import type { DiscoveryManifest, RawNameIndex, RawRelationshipIndex } from './discoveryTypes';
import { UnicodeRelationshipIndex } from './relationships';
import { UnicodeNameIndex } from './search';

const manifestUrl = '/unicode-indexes/unicode-current.json';
let manifestPromise: Promise<DiscoveryManifest> | undefined;
let relationshipPromise: Promise<UnicodeRelationshipIndex> | undefined;
let namePromise: Promise<UnicodeNameIndex> | undefined;

export function loadRelationshipIndex(): Promise<UnicodeRelationshipIndex> {
  relationshipPromise ??= loadManifest().then(async (manifest) => {
    const raw = await fetchJson<RawRelationshipIndex>(resolveAsset(manifest.relationships));
    if (
      raw.unicode_version !== manifest.unicodeVersion ||
      raw.uts39_version !== manifest.uts39Version
    ) {
      throw new Error('Unicode relationship index version does not match its manifest.');
    }
    return new UnicodeRelationshipIndex(raw);
  });
  return relationshipPromise;
}

export function loadNameIndex(): Promise<UnicodeNameIndex> {
  namePromise ??= loadManifest().then(async (manifest) => {
    const raw = await fetchJson<RawNameIndex>(resolveAsset(manifest.names));
    if (raw.unicode_version !== manifest.unicodeVersion) {
      throw new Error('Unicode name index version does not match its manifest.');
    }
    return new UnicodeNameIndex(raw);
  });
  return namePromise;
}

function loadManifest(): Promise<DiscoveryManifest> {
  manifestPromise ??= fetchJson<DiscoveryManifest>(manifestUrl);
  return manifestPromise;
}

function resolveAsset(filename: string): string {
  return new URL(filename, new URL(manifestUrl, window.location.href)).toString();
}

async function fetchJson<Value>(url: string): Promise<Value> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load Unicode discovery data (${response.status}).`);
  return (await response.json()) as Value;
}
