import { displaySequence, unicodeScalarArraysEqual } from '../../unicode';
import {
  check,
  edge,
  evaluation,
  formatScalars,
  graph,
  requireConfusableSkeleton,
  requireGeneralCategory,
  requireScalars,
  requireScalarsValue,
  scalarCountNode,
  source,
  status,
  twoTransformGraph,
  unary,
  yesNo,
} from './shared';
import type { PuzzleRuntimeImplementation } from './types';

export const confusableSkeletonRuntime: PuzzleRuntimeImplementation = {
  evaluate(inputs, operations) {
    const left = requireScalars(inputs.left);
    const right = requireScalars(inputs.right);
    const skeleton = requireConfusableSkeleton(operations);
    const leftSkeleton = skeleton(left);
    const rightSkeleton = skeleton(right);
    const leftNfc = operations.normalize('NFC', left);
    const rightNfc = operations.normalize('NFC', right);
    const nonempty = left.length > 0 && right.length > 0;
    const distinct = !unicodeScalarArraysEqual(left, right);
    const sameSkeleton = unicodeScalarArraysEqual(leftSkeleton, rightSkeleton);
    const nfcDifferent = !unicodeScalarArraysEqual(leftNfc, rightNfc);
    return evaluation(
      nonempty && distinct && sameSkeleton && nfcDifferent,
      sameSkeleton ? displaySequence(leftSkeleton) : '≠',
      sameSkeleton ? formatScalars(leftSkeleton) : 'Skeletons differ',
      [
        check('Inputs differ', yesNo(distinct), distinct),
        check('Skeletons match', yesNo(sameSkeleton), sameSkeleton),
        check('NFC forms differ', yesNo(nfcDifferent), nfcDifferent),
      ],
      {
        left: status(left.length > 0, left.length > 0 ? 'Skeleton ready' : 'Empty'),
        right: status(right.length > 0, right.length > 0 ? 'Skeleton ready' : 'Empty'),
      },
      [
        { label: 'Input A', value: formatScalars(left) },
        { label: 'Input B', value: formatScalars(right) },
      ],
    );
  },
  createGraph(operations) {
    return twoTransformGraph(
      'UTS #39 skeleton',
      requireConfusableSkeleton(operations),
      'Skeletons match',
      'Computes the Unicode UTS #39 confusable skeleton used to detect visually deceptive identifiers.',
      'Compares the two confusable skeleton sequences exactly; matching does not imply semantic equivalence.',
    );
  },
};

export const invisibleFormatRuntime: PuzzleRuntimeImplementation = {
  evaluate(inputs, operations) {
    const input = requireScalars(inputs.input);
    const generalCategory = requireGeneralCategory(operations);
    const categories = Array.from(input, (scalar) => generalCategory(scalar) ?? '—');
    const onlyFormat = input.length > 0 && categories.every((category) => category === 'Cf');
    return evaluation(
      onlyFormat,
      displaySequence(input),
      formatScalars(input),
      [
        check('Non-empty', yesNo(input.length > 0), input.length > 0),
        check('Every category is Cf', categories.join(' ') || '—', onlyFormat),
      ],
      { input: status(onlyFormat, categories.join(' ') || 'Empty') },
      [
        { label: 'Code points', value: formatScalars(input) },
        { label: 'Categories', value: categories.join(' ') },
      ],
    );
  },
  createGraph(operations) {
    return graph(
      [
        source('input', 'Input text', 'scalars'),
        scalarCountNode('scalar-length'),
        unary(
          'format-check',
          'Only format characters',
          'scalars',
          'boolean',
          ([input]) => ({
            kind: 'boolean',
            value:
              requireScalarsValue(input).length > 0 &&
              Array.from(requireScalarsValue(input)).every(
                (scalar) => requireGeneralCategory(operations)(scalar) === 'Cf',
              ),
          }),
          undefined,
          'Checks that the non-empty input consists entirely of Unicode General_Category=Cf format controls.',
        ),
      ],
      [edge('input', 'scalar-length'), edge('input', 'format-check')],
    );
  },
};
