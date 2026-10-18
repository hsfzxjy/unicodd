import {
  displaySequence,
  stringToUtf16CodeUnits,
  unicodeScalarsToString,
  utf8EncodeScalars,
} from '../../unicode';
import { formatUtf16Units, isWellFormedUtf16 } from '../input';
import {
  check,
  edge,
  evaluation,
  formatScalars,
  graph,
  graphemeCount,
  requireBytes,
  requireScalars,
  requireScalarsValue,
  requireUtf16,
  requireUtf16Value,
  scalarCountNode,
  scalarOperation,
  source,
  status,
  unary,
  yesNo,
} from './shared';
import type { PuzzleRuntimeImplementation } from './types';

export const encodingLengthsRuntime: PuzzleRuntimeImplementation = {
  evaluate(inputs, operations) {
    const input = requireScalars(inputs.input);
    const bytes = utf8EncodeScalars(input).length;
    const units = stringToUtf16CodeUnits(unicodeScalarsToString(input)).length;
    const graphemes = graphemeCount(input, operations);
    const success = input.length === 1 && units === 2 && bytes === 4 && graphemes === 1;
    return evaluation(
      success,
      displaySequence(input),
      formatScalars(input),
      [
        check('Unicode scalars', String(input.length), input.length === 1),
        check('Grapheme clusters', String(graphemes), graphemes === 1),
        check('UTF-16 units', String(units), units === 2),
        check('UTF-8 bytes', String(bytes), bytes === 4),
      ],
      {
        input: status(input.length === 1, `${input.length} scalar${input.length === 1 ? '' : 's'}`),
      },
      [
        { label: 'Scalar value', value: formatScalars(input) },
        { label: 'Storage', value: `${bytes} UTF-8 bytes · ${units} UTF-16 units` },
      ],
    );
  },
  createGraph() {
    return graph(
      [
        source('input', 'Input text', 'scalars'),
        scalarOperation(
          'utf8',
          'UTF-8 encode',
          'bytes',
          (input) => ({ kind: 'bytes', value: utf8EncodeScalars(input) }),
          'Encodes every Unicode scalar into its variable-length UTF-8 byte sequence.',
        ),
        unary(
          'utf8-length',
          'UTF-8 length',
          'bytes',
          'count',
          ([input]) => ({ kind: 'count', value: requireBytes(input).length }),
          'bytes',
          'Counts the raw bytes produced by UTF-8 encoding.',
        ),
        scalarOperation(
          'utf16',
          'UTF-16 encode',
          'utf16',
          (input) => ({
            kind: 'utf16',
            value: stringToUtf16CodeUnits(unicodeScalarsToString(input)),
          }),
          'Encodes the scalar sequence as UTF-16 code units. Supplementary scalars become surrogate pairs.',
        ),
        unary(
          'utf16-length',
          'UTF-16 length',
          'utf16',
          'count',
          ([input]) => ({ kind: 'count', value: requireUtf16Value(input).length }),
          'units',
          'Counts UTF-16 code units, matching JavaScript string length semantics.',
        ),
        scalarCountNode('scalar-length'),
      ],
      [
        edge('input', 'utf8'),
        edge('utf8', 'utf8-length'),
        edge('input', 'utf16'),
        edge('utf16', 'utf16-length'),
        edge('input', 'scalar-length'),
      ],
    );
  },
};

export const graphemeManyScalarsRuntime: PuzzleRuntimeImplementation = {
  evaluate(inputs, operations) {
    const input = requireScalars(inputs.input);
    const graphemes = graphemeCount(input, operations);
    const success = input.length >= 3 && graphemes === 1;
    return evaluation(
      success,
      displaySequence(input),
      formatScalars(input),
      [
        check('Grapheme clusters', String(graphemes), graphemes === 1),
        check('Unicode scalars', String(input.length), input.length >= 3),
      ],
      { input: status(graphemes === 1 && input.length > 0, `${graphemes} grapheme`) },
      [
        { label: 'Cluster', value: formatScalars(input) },
        { label: 'Measures', value: `${graphemes} grapheme · ${input.length} scalars` },
      ],
    );
  },
  createGraph(operations) {
    return graph(
      [
        source('input', 'Input text', 'scalars'),
        scalarCountNode('scalar-length'),
        unary(
          'grapheme-count',
          'Grapheme count',
          'scalars',
          'count',
          ([input]) => ({
            kind: 'count',
            value: graphemeCount(requireScalarsValue(input), operations),
          }),
          'graphemes',
          'Segments the sequence into extended grapheme clusters and counts the user-perceived text units.',
        ),
      ],
      [edge('input', 'scalar-length'), edge('input', 'grapheme-count')],
    );
  },
};

export const malformedUtf16Runtime: PuzzleRuntimeImplementation = {
  evaluate(inputs) {
    const units = requireUtf16(inputs.input);
    const wellFormed = isWellFormedUtf16(units);
    const success = units.length > 0 && !wellFormed;
    return evaluation(
      success,
      wellFormed ? 'Valid UTF-16' : 'Unpaired surrogate',
      formatUtf16Units(units),
      [
        check('Non-empty', yesNo(units.length > 0), units.length > 0),
        check('Structurally malformed', yesNo(!wellFormed), !wellFormed),
      ],
      { input: status(success, wellFormed ? 'Well-formed' : 'Malformed') },
      [
        { label: 'Code units', value: formatUtf16Units(units) },
        { label: 'Validation', value: wellFormed ? 'Well-formed UTF-16' : 'Unpaired surrogate' },
      ],
    );
  },
  createGraph() {
    return graph(
      [
        source('input', 'Raw UTF-16 units', 'utf16'),
        unary(
          'unit-length',
          'Code-unit length',
          'utf16',
          'count',
          ([input]) => ({ kind: 'count', value: requireUtf16Value(input).length }),
          'units',
          'Counts the supplied 16-bit code units without first decoding them as Unicode scalars.',
        ),
        unary(
          'valid',
          'Structurally valid',
          'utf16',
          'boolean',
          ([input]) => ({ kind: 'boolean', value: isWellFormedUtf16(requireUtf16Value(input)) }),
          undefined,
          'Validates surrogate pairing without replacing or discarding malformed UTF-16 code units.',
        ),
      ],
      [edge('input', 'unit-length'), edge('input', 'valid')],
    );
  },
};
