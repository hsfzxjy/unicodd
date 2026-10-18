import type { PuzzleDefinition } from './types';

const discoveryCapabilities = new Set(['confusable-index', 'property-index']);

export function requiresDiscoveryIndex(definition: PuzzleDefinition): boolean {
  return definition.capabilities.some((capability) => discoveryCapabilities.has(capability));
}
