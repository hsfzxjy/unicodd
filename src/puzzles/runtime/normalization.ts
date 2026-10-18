import { displaySequence, unicodeScalarArraysEqual } from '../../unicode';
import {
  createNormalizationPuzzleGraph,
  evaluateNormalizationPuzzle,
} from '../normalizationConcatenation';
import {
  check,
  edge,
  evaluation,
  formatScalars,
  graph,
  requireScalars,
  scalarOperation,
  source,
  status,
  yesNo,
} from './shared';
import type { PuzzleRuntimeImplementation } from './types';

export const nfcConcatenationRuntime: PuzzleRuntimeImplementation = {
  evaluate(inputs, operations) {
    const left = requireScalars(inputs.left);
    const right = requireScalars(inputs.right);
    const result = evaluateNormalizationPuzzle(left, right, (input) =>
      operations.normalize('NFC', input),
    );
    return evaluation(
      result.success,
      displaySequence(result.joined),
      formatScalars(result.joined),
      [
        check(
          'Input A is NFC',
          left.length > 0 ? yesNo(result.leftIsNfc) : '—',
          left.length > 0 && result.leftIsNfc,
        ),
        check(
          'Input B is NFC',
          right.length > 0 ? yesNo(result.rightIsNfc) : '—',
          right.length > 0 && result.rightIsNfc,
        ),
        check('Join changes under NFC', yesNo(!result.joinedIsNfc), !result.joinedIsNfc),
      ],
      {
        left: status(
          result.leftIsNfc && left.length > 0,
          left.length === 0 ? 'Empty' : result.leftIsNfc ? 'NFC' : 'Needs NFC',
        ),
        right: status(
          result.rightIsNfc && right.length > 0,
          right.length === 0 ? 'Empty' : result.rightIsNfc ? 'NFC' : 'Needs NFC',
        ),
      },
      [
        { label: 'Entered', value: formatScalars(result.joined) },
        { label: 'After NFC', value: formatScalars(result.joinedNormalized) },
      ],
    );
  },
  createGraph(operations) {
    return createNormalizationPuzzleGraph((input) => operations.normalize('NFC', input));
  },
};

export const compatibilityNormalizationRuntime: PuzzleRuntimeImplementation = {
  evaluate(inputs, operations) {
    const input = requireScalars(inputs.input);
    const nfc = operations.normalize('NFC', input);
    const nfkc = operations.normalize('NFKC', input);
    const nfcSame = unicodeScalarArraysEqual(input, nfc);
    const nfkcChanges = !unicodeScalarArraysEqual(input, nfkc);
    const success = input.length > 0 && nfcSame && nfkcChanges;
    return evaluation(
      success,
      displaySequence(nfkc),
      formatScalars(nfkc),
      [
        check('Non-empty', yesNo(input.length > 0), input.length > 0),
        check('NFC unchanged', yesNo(nfcSame), nfcSame),
        check('NFKC changes', yesNo(nfkcChanges), nfkcChanges),
      ],
      {
        input: status(
          input.length > 0 && nfcSame,
          input.length === 0 ? 'Empty' : nfcSame ? 'NFC stable' : 'NFC changes',
        ),
      },
      [
        { label: 'Entered', value: formatScalars(input) },
        { label: 'After NFKC', value: formatScalars(nfkc) },
      ],
    );
  },
  createGraph(operations) {
    return graph(
      [
        source('input', 'Input text', 'scalars'),
        scalarOperation(
          'nfc',
          'NFC',
          'scalars',
          (input) => ({ kind: 'scalars', value: operations.normalize('NFC', input) }),
          'Applies canonical composition only, preserving compatibility distinctions.',
        ),
        scalarOperation(
          'nfkc',
          'NFKC',
          'scalars',
          (input) => ({ kind: 'scalars', value: operations.normalize('NFKC', input) }),
          'Applies compatibility decomposition followed by canonical composition, so formatting variants may collapse.',
        ),
      ],
      [edge('input', 'nfc'), edge('input', 'nfkc')],
    );
  },
};
