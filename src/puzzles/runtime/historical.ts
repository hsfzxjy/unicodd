import { displaySequence, unicodeScalarArraysEqual } from '../../unicode';
import {
  check,
  edge,
  evaluation,
  formatScalars,
  graph,
  requireHistoricalNormalizer,
  requireScalars,
  requireScalarsValue,
  scalarOperation,
  source,
  status,
  yesNo,
} from './shared';
import type { PuzzleRuntimeImplementation } from './types';

export const historicalNormalizationRuntime: PuzzleRuntimeImplementation = {
  evaluate(inputs, operations) {
    const input = requireScalars(inputs.input);
    const historical = requireHistoricalNormalizer(operations)('NFKC', input);
    const current = operations.normalize('NFKC', input);
    const historicalSame = unicodeScalarArraysEqual(input, historical);
    const currentChanges = !unicodeScalarArraysEqual(input, current);
    const versionsDiffer = !unicodeScalarArraysEqual(historical, current);
    const currentIsAscii = Array.from(current).every((scalar) => scalar <= 0x7f);
    const success =
      input.length === 1 && historicalSame && currentChanges && versionsDiffer && currentIsAscii;
    return evaluation(
      success,
      displaySequence(current),
      formatScalars(current),
      [
        check('One scalar', String(input.length), input.length === 1),
        check('15.1 NFKC unchanged', yesNo(historicalSame), historicalSame),
        check('17 NFKC changes', yesNo(currentChanges), currentChanges),
        check('Current result is ASCII', yesNo(currentIsAscii), currentIsAscii),
      ],
      {
        input: status(
          versionsDiffer,
          input.length === 0 ? 'Empty' : versionsDiffer ? 'Profiles differ' : 'Same result',
        ),
      },
      [
        { label: 'Unicode 15.1 NFKC', value: formatScalars(historical) },
        { label: 'Unicode 17 NFKC', value: formatScalars(current) },
      ],
    );
  },
  createGraph(operations) {
    const normalizeHistorical = requireHistoricalNormalizer(operations);
    return graph(
      [
        source('input', 'Input text', 'scalars'),
        scalarOperation(
          'unicode-15',
          'NFKC · Unicode 15.1',
          'scalars',
          (input) => ({ kind: 'scalars', value: normalizeHistorical('NFKC', input) }),
          'Runs compatibility normalization with the separately pinned Unicode 15.1 engine.',
        ),
        scalarOperation(
          'unicode-17',
          'NFKC · Unicode 17',
          'scalars',
          (input) => ({ kind: 'scalars', value: operations.normalize('NFKC', input) }),
          'Runs compatibility normalization with the current pinned Unicode 17 engine.',
        ),
        {
          id: 'compare',
          label: 'Results differ',
          explanation:
            'Compares the two versioned normalization results exactly to expose a real Unicode-version difference.',
          inputKinds: ['scalars', 'scalars'],
          outputKind: 'boolean',
          execute: ([historical, current]) => ({
            kind: 'boolean',
            value: !unicodeScalarArraysEqual(
              requireScalarsValue(historical),
              requireScalarsValue(current),
            ),
          }),
        },
      ],
      [
        edge('input', 'unicode-15'),
        edge('input', 'unicode-17'),
        edge('unicode-15', 'compare'),
        edge('unicode-17', 'compare'),
      ],
    );
  },
};
