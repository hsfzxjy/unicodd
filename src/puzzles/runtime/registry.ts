import type { PuzzleRuntimeId } from '../catalog';
import { caseFoldCollisionRuntime } from './casing';
import { historicalNormalizationRuntime } from './historical';
import {
  encodingLengthsRuntime,
  graphemeManyScalarsRuntime,
  malformedUtf16Runtime,
} from './measurement';
import { compatibilityNormalizationRuntime, nfcConcatenationRuntime } from './normalization';
import { confusableSkeletonRuntime, invisibleFormatRuntime } from './security';
import type { PuzzleRuntimeImplementation } from './types';

export const puzzleRuntimeRegistry = {
  'nfc-concatenation-boundary': nfcConcatenationRuntime,
  'encoding-lengths': encodingLengthsRuntime,
  'grapheme-many-scalars': graphemeManyScalarsRuntime,
  'case-fold-collision': caseFoldCollisionRuntime,
  'compatibility-normalization': compatibilityNormalizationRuntime,
  'confusable-skeleton-collision': confusableSkeletonRuntime,
  'invisible-format-controls': invisibleFormatRuntime,
  'malformed-utf16': malformedUtf16Runtime,
  'historical-normalization': historicalNormalizationRuntime,
} satisfies Record<PuzzleRuntimeId, PuzzleRuntimeImplementation>;
