import type { AppLocale } from '../i18n';
import chinesePuzzleTranslations from './translations/zh-CN.json';
import type { PuzzleDefinition, PuzzleInputDefinition } from './types';

interface PuzzleInputTranslation {
  label: string;
  description: string;
  placeholder?: string;
}

interface PuzzleTranslation {
  theme: string;
  title: string;
  objective: string;
  defaultUnicodeProfile: string;
  inputs: Record<string, PuzzleInputTranslation>;
  graphTitle: string;
  graphDescription: string;
  resultLabel: string;
  hints: string[];
  explanation: string;
  references: string[];
}

const chineseTranslations = chinesePuzzleTranslations as Record<string, PuzzleTranslation>;

export function localizePuzzleDefinition(
  definition: PuzzleDefinition,
  locale: AppLocale,
): PuzzleDefinition {
  if (locale === 'en') return definition;

  const translation = chineseTranslations[definition.id];
  if (!translation) {
    throw new Error(`Missing zh-CN translation for puzzle “${definition.id}”.`);
  }
  validateTranslation(definition, translation);

  return {
    ...definition,
    theme: translation.theme,
    title: translation.title,
    objective: translation.objective,
    defaultUnicodeProfile: translation.defaultUnicodeProfile,
    inputs: definition.inputs.map((input) => localizeInput(input, translation.inputs[input.id]!)),
    graphTitle: translation.graphTitle,
    graphDescription: translation.graphDescription,
    resultLabel: translation.resultLabel,
    hints: translation.hints,
    explanation: translation.explanation,
    references: definition.references.map((reference, index) => ({
      ...reference,
      label: translation.references[index]!,
    })),
  };
}

export function validatePuzzleTranslations(definitions: readonly PuzzleDefinition[]): void {
  const ids = new Set(definitions.map(({ id }) => id));
  for (const definition of definitions) {
    const translation = chineseTranslations[definition.id];
    if (!translation) {
      throw new Error(`Missing zh-CN translation for puzzle “${definition.id}”.`);
    }
    validateTranslation(definition, translation);
  }
  for (const id of Object.keys(chineseTranslations)) {
    if (!ids.has(id)) throw new Error(`zh-CN translation references unknown puzzle “${id}”.`);
  }
}

function localizeInput(
  input: PuzzleInputDefinition,
  translation: PuzzleInputTranslation,
): PuzzleInputDefinition {
  const localized = {
    ...input,
    label: translation.label,
    description: translation.description,
  };
  if (translation.placeholder !== undefined) localized.placeholder = translation.placeholder;
  return localized;
}

function validateTranslation(definition: PuzzleDefinition, translation: PuzzleTranslation): void {
  const requiredText = [
    translation.theme,
    translation.title,
    translation.objective,
    translation.defaultUnicodeProfile,
    translation.graphTitle,
    translation.graphDescription,
    translation.resultLabel,
    translation.explanation,
  ];
  if (requiredText.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new Error(`Puzzle “${definition.id}” has an incomplete zh-CN translation.`);
  }
  if (
    !Array.isArray(translation.hints) ||
    translation.hints.length !== definition.hints.length ||
    translation.hints.some((hint) => typeof hint !== 'string' || !hint.trim())
  ) {
    throw new Error(`Puzzle “${definition.id}” must translate every hint into zh-CN.`);
  }
  if (
    !Array.isArray(translation.references) ||
    translation.references.length !== definition.references.length ||
    translation.references.some((reference) => typeof reference !== 'string' || !reference.trim())
  ) {
    throw new Error(`Puzzle “${definition.id}” must translate every reference into zh-CN.`);
  }
  const translatedInputIds = Object.keys(translation.inputs).sort();
  const inputIds = definition.inputs.map(({ id }) => id).sort();
  if (translatedInputIds.join('|') !== inputIds.join('|')) {
    throw new Error(`Puzzle “${definition.id}” must translate every input into zh-CN.`);
  }
  for (const input of definition.inputs) {
    const translated = translation.inputs[input.id];
    if (!translated?.label.trim() || !translated.description.trim()) {
      throw new Error(`Puzzle “${definition.id}” has an incomplete zh-CN input translation.`);
    }
  }
}
