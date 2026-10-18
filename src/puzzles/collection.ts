import type { AppLocale } from '../i18n';
import { puzzleCatalog } from './catalog';
import { localizePuzzleDefinition } from './localization';
import { localizeEvaluation, localizeGraph } from './runtime/localization';
import { puzzleRuntimeRegistry } from './runtime/registry';
import { createSources } from './runtime/shared';
import type { PuzzleRuntime } from './types';

export function createPuzzleCollection(locale: AppLocale = 'en'): PuzzleRuntime[] {
  return puzzleCatalog.map(({ runtime, definition: sourceDefinition }) => {
    const implementation = puzzleRuntimeRegistry[runtime];
    const definition = localizePuzzleDefinition(sourceDefinition, locale);
    return {
      definition,
      evaluate: (inputs, operations) =>
        localizeEvaluation(runtime, locale, implementation.evaluate(inputs, operations)),
      createGraph: (operations) =>
        localizeGraph(runtime, locale, implementation.createGraph(operations)),
      createSources: (inputs) => createSources(definition, inputs),
    };
  });
}

export const puzzleCollection: PuzzleRuntime[] = createPuzzleCollection();
