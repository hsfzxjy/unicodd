import type { OperationGraph, OperationNode, OperationValue } from '../engine/types';
import {
  displaySequence,
  formatCodePoint,
  stringToUtf16CodeUnits,
  unicodeScalarArraysEqual,
  unicodeScalarsToString,
  utf8EncodeScalars,
} from '../unicode';
import {
  createNormalizationPuzzleGraph,
  evaluateNormalizationPuzzle,
  normalizationConcatenationPuzzle,
} from './normalizationConcatenation';
import { formatUtf16Units, isWellFormedUtf16 } from './input';
import type {
  PreparedPuzzleInput,
  PuzzleDefinition,
  PuzzleEvaluation,
  PuzzleOperations,
  PuzzleRuntime,
} from './types';

const profile = 'Unicode 17 / ICU4X 2.3';

const definitions: PuzzleDefinition[] = [
  normalizationConcatenationPuzzle,
  {
    id: 'encoding-lengths',
    number: 2,
    theme: 'Encodings',
    title: 'One character, four bytes',
    objective:
      'Find one Unicode scalar that is one grapheme, two UTF-16 code units, and four UTF-8 bytes.',
    defaultUnicodeProfile: profile,
    inputs: [textInput('input', 'Text', 'Try a supplementary-plane character.')],
    graphTitle: 'Count three representations',
    graphDescription: 'The same scalar sequence is encoded as UTF-8 and UTF-16 before counting.',
    resultLabel: 'Encoding measures',
    hints: [
      'Characters outside the Basic Multilingual Plane need a UTF-16 surrogate pair.',
      'Emoji are a familiar place to look for supplementary characters.',
      'Try 🧩 or another single emoji without a variation selector.',
    ],
    explanation:
      'A supplementary scalar is still one Unicode scalar and often one grapheme, but UTF-16 stores it as a surrogate pair while UTF-8 uses four bytes.',
  },
  {
    id: 'grapheme-many-scalars',
    number: 3,
    theme: 'Graphemes',
    title: 'More pieces than characters',
    objective: 'Build one grapheme cluster containing at least three Unicode scalars.',
    defaultUnicodeProfile: profile,
    inputs: [textInput('input', 'Text', 'Combine marks or use an emoji ZWJ sequence.')],
    graphTitle: 'Segment what looks whole',
    graphDescription: 'ICU4X counts extended grapheme clusters independently from scalars.',
    resultLabel: 'Cluster measures',
    hints: [
      'Combining marks can extend a base without starting a new grapheme.',
      'Emoji joined by U+200D ZERO WIDTH JOINER can also form one cluster.',
      'Try e followed by U+0301 and U+0323.',
    ],
    explanation:
      'User-perceived characters are grapheme clusters, not fixed-width storage units. One cluster can contain a base plus several marks, or an entire emoji ZWJ sequence.',
  },
  {
    id: 'case-fold-collision',
    number: 4,
    theme: 'Case folding',
    title: 'Different cases, same key',
    objective: 'Find two distinct non-empty strings with the same default Unicode case fold.',
    defaultUnicodeProfile: profile,
    inputs: [
      textInput('left', 'Input A', 'The first spelling.'),
      textInput('right', 'Input B', 'A distinct spelling that folds the same way.'),
    ],
    graphTitle: 'Fold both strings',
    graphDescription: 'ICU4X applies full default case folding before comparing the results.',
    resultLabel: 'Fold comparison',
    hints: [
      'Uppercase and lowercase ASCII letters already share folds.',
      'Full folding can expand one scalar into several scalars.',
      'Compare Straße with STRASSE.',
    ],
    explanation:
      'Case folding is intended for caseless comparison, not display. Full folding may expand characters—German ß folds to ss—so distinct strings can share one comparison key.',
  },
  {
    id: 'compatibility-normalization',
    number: 5,
    theme: 'Compatibility',
    title: 'Formatting that disappears',
    objective: 'Find a non-empty string that NFC keeps unchanged but NFKC changes.',
    defaultUnicodeProfile: profile,
    inputs: [textInput('input', 'Text', 'Look for circled, wide, or superscript forms.')],
    graphTitle: 'Compare canonical and compatibility forms',
    graphDescription: 'NFC preserves compatibility distinctions that NFKC intentionally removes.',
    resultLabel: 'Normalization comparison',
    hints: [
      'Compatibility characters encode a presentation or semantic distinction.',
      'The explorer lists compatibility relatives separately from canonical relatives.',
      'Try ①, fullwidth ａ, or superscript ¹.',
    ],
    explanation:
      'NFC only resolves canonical equivalence. NFKC additionally removes compatibility distinctions, so symbols such as circled digits can normalize to ordinary text.',
  },
  {
    id: 'confusable-skeleton-collision',
    number: 6,
    theme: 'Confusables',
    title: 'Looks equal, stays different',
    objective:
      'Find two distinct strings with the same UTS #39 confusable skeleton but different NFC forms.',
    defaultUnicodeProfile: 'Unicode 17 / UTS #39',
    inputs: [
      textInput('left', 'Input A', 'A familiar-looking string.'),
      textInput('right', 'Input B', 'A distinct look-alike string.'),
    ],
    graphTitle: 'Compare security skeletons',
    graphDescription:
      'Pinned UTS #39 mappings produce a security-oriented skeleton for each input.',
    resultLabel: 'Skeleton comparison',
    hints: [
      'Confusable characters are not necessarily normalization-equivalent.',
      'Explore visual confusables for the Latin letter a.',
      'Compare Latin a with Cyrillic а (U+0430).',
    ],
    explanation:
      'UTS #39 skeletons flag text that may be visually confusable. The relationship is a security signal, not canonical equivalence, semantic equality, or a guarantee for every font.',
  },
  {
    id: 'invisible-format-controls',
    number: 7,
    theme: 'Invisible text',
    title: 'Something from nothing',
    objective: 'Enter a non-empty string made entirely from Unicode format characters (Cf).',
    defaultUnicodeProfile: profile,
    inputs: [textInput('input', 'Text', 'Invisible input is represented by labeled tokens.')],
    graphTitle: 'Inspect the hidden payload',
    graphDescription: 'The graph counts real scalars and checks their Unicode general category.',
    resultLabel: 'Visibility check',
    hints: [
      'Search for ZERO WIDTH SPACE or WORD JOINER in the character lab.',
      'Format characters have General_Category=Cf.',
      'Try U+200B ZERO WIDTH SPACE.',
    ],
    explanation:
      'A string can contain real data without an ordinary visible glyph. Format controls can affect layout, joining, ordering, or parsing even when the rendered line appears empty.',
  },
  {
    id: 'malformed-utf16',
    number: 8,
    theme: 'Malformed UTF-16',
    title: 'Half an emoji',
    objective: 'Enter a non-empty UTF-16 code-unit sequence that is not structurally well-formed.',
    defaultUnicodeProfile: 'Version-independent UTF-16',
    inputs: [
      {
        id: 'input',
        label: 'UTF-16 units',
        description: 'Hexadecimal code units separated by spaces.',
        kind: 'utf16-units',
        placeholder: 'D83E DDE9',
        initialValue: '',
      },
    ],
    graphTitle: 'Validate raw code units',
    graphDescription: 'This path models UTF-16 directly, so unpaired surrogates are preserved.',
    resultLabel: 'Structural validation',
    hints: [
      'Supplementary scalars use a high surrogate followed by a low surrogate.',
      'Remove either half of a valid surrogate pair.',
      'Try the lone high-surrogate code unit D83E.',
    ],
    explanation:
      'UTF-16 code units can contain unpaired surrogates even though Unicode scalar sequences cannot. Validation must detect that structure explicitly instead of silently replacing it.',
  },
];

export const puzzleCollection: PuzzleRuntime[] = definitions.map(createRuntime);

function createRuntime(definition: PuzzleDefinition): PuzzleRuntime {
  return {
    definition,
    evaluate: (inputs, operations) => evaluate(definition.id, inputs, operations),
    createGraph: (operations) => createGraph(definition, operations),
    createSources: (inputs) => createSources(definition, inputs),
  };
}

function evaluate(
  id: string,
  inputs: Readonly<Record<string, PreparedPuzzleInput>>,
  operations: PuzzleOperations,
): PuzzleEvaluation {
  if (id === 'nfc-concatenation-boundary') {
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
  }

  if (id === 'encoding-lengths') {
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
  }

  if (id === 'grapheme-many-scalars') {
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
  }

  if (id === 'case-fold-collision') {
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
  }

  if (id === 'compatibility-normalization') {
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
  }

  if (id === 'confusable-skeleton-collision') {
    const left = requireScalars(inputs.left);
    const right = requireScalars(inputs.right);
    const leftSkeleton = operations.confusableSkeleton(left);
    const rightSkeleton = operations.confusableSkeleton(right);
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
  }

  if (id === 'invisible-format-controls') {
    const input = requireScalars(inputs.input);
    const categories = Array.from(input, (scalar) => operations.generalCategory(scalar) ?? '—');
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
  }

  if (id === 'malformed-utf16') {
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
  }

  throw new Error(`Unknown puzzle ${id}.`);
}

function createGraph(definition: PuzzleDefinition, operations: PuzzleOperations): OperationGraph {
  const id = definition.id;
  if (id === 'nfc-concatenation-boundary') {
    return createNormalizationPuzzleGraph((input) => operations.normalize('NFC', input));
  }
  if (id === 'encoding-lengths') {
    return graph(
      [
        source('input', 'Input text', 'scalars'),
        scalarOperation('utf8', 'UTF-8 encode', 'bytes', (input) => ({
          kind: 'bytes',
          value: utf8EncodeScalars(input),
        })),
        unary(
          'utf8-length',
          'UTF-8 length',
          'bytes',
          'count',
          ([input]) => ({
            kind: 'count',
            value: requireBytes(input).length,
          }),
          'bytes',
        ),
        scalarOperation('utf16', 'UTF-16 encode', 'utf16', (input) => ({
          kind: 'utf16',
          value: stringToUtf16CodeUnits(unicodeScalarsToString(input)),
        })),
        unary(
          'utf16-length',
          'UTF-16 length',
          'utf16',
          'count',
          ([input]) => ({
            kind: 'count',
            value: requireUtf16Value(input).length,
          }),
          'units',
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
  }
  if (id === 'grapheme-many-scalars') {
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
        ),
      ],
      [edge('input', 'scalar-length'), edge('input', 'grapheme-count')],
    );
  }
  if (id === 'case-fold-collision') {
    return twoTransformGraph('Default case fold', operations.caseFold, 'Folds match');
  }
  if (id === 'compatibility-normalization') {
    return graph(
      [
        source('input', 'Input text', 'scalars'),
        scalarOperation('nfc', 'NFC', 'scalars', (input) => ({
          kind: 'scalars',
          value: operations.normalize('NFC', input),
        })),
        scalarOperation('nfkc', 'NFKC', 'scalars', (input) => ({
          kind: 'scalars',
          value: operations.normalize('NFKC', input),
        })),
      ],
      [edge('input', 'nfc'), edge('input', 'nfkc')],
    );
  }
  if (id === 'confusable-skeleton-collision') {
    return twoTransformGraph('UTS #39 skeleton', operations.confusableSkeleton, 'Skeletons match');
  }
  if (id === 'invisible-format-controls') {
    return graph(
      [
        source('input', 'Input text', 'scalars'),
        scalarCountNode('scalar-length'),
        unary('format-check', 'Only format characters', 'scalars', 'boolean', ([input]) => ({
          kind: 'boolean',
          value:
            requireScalarsValue(input).length > 0 &&
            Array.from(requireScalarsValue(input)).every(
              (scalar) => operations.generalCategory(scalar) === 'Cf',
            ),
        })),
      ],
      [edge('input', 'scalar-length'), edge('input', 'format-check')],
    );
  }
  if (id === 'malformed-utf16') {
    return graph(
      [
        source('input', 'Raw UTF-16 units', 'utf16'),
        unary(
          'unit-length',
          'Code-unit length',
          'utf16',
          'count',
          ([input]) => ({
            kind: 'count',
            value: requireUtf16Value(input).length,
          }),
          'units',
        ),
        unary('valid', 'Structurally valid', 'utf16', 'boolean', ([input]) => ({
          kind: 'boolean',
          value: isWellFormedUtf16(requireUtf16Value(input)),
        })),
      ],
      [edge('input', 'unit-length'), edge('input', 'valid')],
    );
  }
  throw new Error(`Unknown puzzle graph ${id}.`);
}

function createSources(
  definition: PuzzleDefinition,
  inputs: Readonly<Record<string, PreparedPuzzleInput>>,
): Readonly<Record<string, OperationValue>> {
  return Object.fromEntries(
    definition.inputs.map((input) => {
      const prepared = inputs[input.id];
      return input.kind === 'utf16-units'
        ? [input.id, { kind: 'utf16', value: requireUtf16(prepared) } satisfies OperationValue]
        : [input.id, { kind: 'scalars', value: requireScalars(prepared) } satisfies OperationValue];
    }),
  );
}

function twoTransformGraph(
  transformLabel: string,
  transform: (input: Uint32Array) => Uint32Array,
  comparisonLabel: string,
): OperationGraph {
  return graph(
    [
      source('left', 'Input A', 'scalars'),
      source('right', 'Input B', 'scalars'),
      scalarOperation('left-result', `${transformLabel}(A)`, 'scalars', (input) => ({
        kind: 'scalars',
        value: transform(input),
      })),
      scalarOperation('right-result', `${transformLabel}(B)`, 'scalars', (input) => ({
        kind: 'scalars',
        value: transform(input),
      })),
      {
        id: 'compare',
        label: comparisonLabel,
        inputKinds: ['scalars', 'scalars'],
        outputKind: 'boolean',
        execute: ([left, right]) => ({
          kind: 'boolean',
          value: unicodeScalarArraysEqual(requireScalarsValue(left), requireScalarsValue(right)),
        }),
      },
    ],
    [
      edge('left', 'left-result'),
      edge('right', 'right-result'),
      edge('left-result', 'compare'),
      edge('right-result', 'compare'),
    ],
  );
}

function textInput(id: string, label: string, description: string) {
  return { id, label, description, kind: 'text' as const, initialValue: '' };
}

function graph(nodes: OperationNode[], edges: OperationGraph['edges']): OperationGraph {
  return { nodes, edges };
}

function source(id: string, label: string, outputKind: OperationNode['outputKind']): OperationNode {
  return { id, label, inputKinds: [], outputKind };
}

function unary(
  id: string,
  label: string,
  inputKind: OperationNode['outputKind'],
  outputKind: OperationNode['outputKind'],
  execute: NonNullable<OperationNode['execute']>,
  outputUnit?: string,
): OperationNode {
  return { id, label, inputKinds: [inputKind], outputKind, outputUnit, execute };
}

function scalarOperation(
  id: string,
  label: string,
  outputKind: OperationNode['outputKind'],
  execute: (input: Uint32Array) => OperationValue,
): OperationNode {
  return unary(id, label, 'scalars', outputKind, ([input]) => execute(requireScalarsValue(input)));
}

function scalarCountNode(id: string): OperationNode {
  return unary(
    id,
    'Scalar count',
    'scalars',
    'count',
    ([input]) => ({ kind: 'count', value: requireScalarsValue(input).length }),
    'scalars',
  );
}

function edge(sourceId: string, target: string): OperationGraph['edges'][number] {
  return { id: `${sourceId}-to-${target}`, source: sourceId, target };
}

function evaluation(
  success: boolean,
  preview: string,
  code: string,
  checks: PuzzleEvaluation['checks'],
  inputStatuses: PuzzleEvaluation['inputStatuses'],
  details: PuzzleEvaluation['details'],
): PuzzleEvaluation {
  return {
    success,
    preview,
    code,
    status: success ? 'Target reached' : 'Keep exploring',
    checks,
    inputStatuses,
    details,
  };
}

function check(label: string, value: string, passed: boolean) {
  return { label, value, passed };
}

function status(passed: boolean, label: string) {
  return { passed, label };
}

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

function formatScalars(value: Uint32Array): string {
  return value.length ? Array.from(value, formatCodePoint).join(' ') : 'Empty sequence';
}

function graphemeCount(input: Uint32Array, operations: PuzzleOperations): number {
  return Math.max(operations.graphemeBoundaries(input).length - 1, 0);
}

function requireScalars(input: PreparedPuzzleInput | undefined): Uint32Array {
  if (!input?.scalars) throw new TypeError('Puzzle input is not a valid Unicode scalar sequence.');
  return input.scalars;
}

function requireUtf16(input: PreparedPuzzleInput | undefined): Uint16Array {
  if (!input?.utf16) throw new TypeError('Puzzle input is not a valid UTF-16 code-unit sequence.');
  return input.utf16;
}

function requireScalarsValue(input: OperationValue | undefined): Uint32Array {
  if (!input || input.kind !== 'scalars') throw new TypeError('Operation requires scalar input.');
  return input.value;
}

function requireBytes(input: OperationValue | undefined): Uint8Array {
  if (!input || input.kind !== 'bytes') throw new TypeError('Operation requires byte input.');
  return input.value;
}

function requireUtf16Value(input: OperationValue | undefined): Uint16Array {
  if (!input || input.kind !== 'utf16') throw new TypeError('Operation requires UTF-16 input.');
  return input.value;
}
