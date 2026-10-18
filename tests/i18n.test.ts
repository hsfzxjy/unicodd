import { describe, expect, it } from 'vitest';
import { translate } from '../src/i18n';
import { createPuzzleCollection } from '../src/puzzles/collection';
import { preparePuzzleInput } from '../src/puzzles/input';
import type { PuzzleOperations } from '../src/puzzles/types';
import { stringToUnicodeScalars, unicodeScalarsToString } from '../src/unicode';

const operations: PuzzleOperations = {
  normalize: (form, input) => stringToUnicodeScalars(unicodeScalarsToString(input).normalize(form)),
  caseFold: (input) => input,
  graphemeBoundaries: (input) => Uint32Array.from({ length: input.length + 1 }, (_, i) => i),
};

describe('internationalization', () => {
  it('translates application copy with interpolation', () => {
    expect(translate('puzzle.numberTheme', { number: 3, theme: '字素簇' }, 'zh-CN')).toBe(
      '谜题 3 · 字素簇',
    );
    expect(translate('puzzle.numberTheme', { number: 3, theme: 'Graphemes' }, 'en')).toBe(
      'Puzzle 3 · Graphemes',
    );
  });

  it('provides complete Chinese puzzle definitions without changing stable structure', () => {
    const english = createPuzzleCollection('en');
    const chinese = createPuzzleCollection('zh-CN');

    expect(chinese).toHaveLength(english.length);
    expect(chinese.map(({ definition }) => definition.id)).toEqual(
      english.map(({ definition }) => definition.id),
    );
    expect(chinese[0]!.definition.title).toBe('字符串中的接缝');
    expect(chinese[0]!.definition.inputs.map(({ label }) => label)).toEqual(['输入 A', '输入 B']);
    expect(chinese.every(({ definition }) => definition.hints.every(Boolean))).toBe(true);
  });

  it('localizes executable graph explanations and evaluation results', () => {
    const puzzle = createPuzzleCollection('zh-CN')[0]!;
    const definitions = puzzle.definition.inputs;
    const inputs = {
      left: preparePuzzleInput(definitions[0]!, 'e'),
      right: preparePuzzleInput(definitions[1]!, '\u0301'),
    };

    const evaluation = puzzle.evaluate(inputs, operations);
    const graph = puzzle.createGraph(operations);

    expect(evaluation.success).toBe(true);
    expect(evaluation.status).toBe('已达到目标');
    expect(evaluation.checks[0]?.label).toBe('输入 A 是 NFC');
    expect(graph.nodes.find(({ id }) => id === 'join')?.label).toBe('拼接 A + B');
    expect(graph.nodes.find(({ id }) => id === 'join')?.explanation).toContain('不对任一侧');
  });
});
