import { displaySequence, unicodeScalarArraysEqual } from '../../unicode';
import {
  check,
  evaluation,
  formatScalars,
  requireScalars,
  status,
  twoTransformGraph,
  yesNo,
} from './shared';
import type { PuzzleRuntimeImplementation } from './types';

export const caseFoldCollisionRuntime: PuzzleRuntimeImplementation = {
  evaluate(inputs, operations) {
    const left = requireScalars(inputs.left);
    const right = requireScalars(inputs.right);
    const leftFold = operations.caseFold(left);
    const rightFold = operations.caseFold(right);
    const distinct = !unicodeScalarArraysEqual(left, right);
    const sameFold = unicodeScalarArraysEqual(leftFold, rightFold);
    const nonempty = left.length > 0 && right.length > 0;
    return evaluation(
      nonempty && distinct && sameFold,
      sameFold ? displaySequence(leftFold) : '≠',
      sameFold ? formatScalars(leftFold) : 'Case folds differ',
      [
        check('Both non-empty', yesNo(nonempty), nonempty),
        check('Inputs differ', yesNo(distinct), distinct),
        check('Case folds match', yesNo(sameFold), sameFold),
      ],
      {
        left: status(left.length > 0, left.length > 0 ? 'Folded' : 'Empty'),
        right: status(right.length > 0, right.length > 0 ? 'Folded' : 'Empty'),
      },
      [
        { label: 'Input A fold', value: formatScalars(leftFold) },
        { label: 'Input B fold', value: formatScalars(rightFold) },
      ],
    );
  },
  createGraph(operations) {
    return twoTransformGraph(
      'Default case fold',
      operations.caseFold,
      'Folds match',
      'Applies Unicode default full case folding for caseless comparison; this is not locale-specific lowercasing.',
      'Compares the two folded scalar sequences exactly.',
    );
  },
};
