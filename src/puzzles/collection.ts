import type { OperationGraph, OperationNode, OperationValue } from '../engine/types';
import type { AppLocale } from '../i18n';
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
} from './normalizationConcatenation';
import { puzzleCatalog, type PuzzleRuntimeId } from './catalog';
import { formatUtf16Units, isWellFormedUtf16 } from './input';
import { localizePuzzleDefinition } from './localization';
import type {
  PreparedPuzzleInput,
  PuzzleDefinition,
  PuzzleEvaluation,
  PuzzleOperations,
  PuzzleRuntime,
} from './types';

export function createPuzzleCollection(locale: AppLocale = 'en'): PuzzleRuntime[] {
  return puzzleCatalog.map((entry) => createRuntime(entry, locale));
}

export const puzzleCollection: PuzzleRuntime[] = createPuzzleCollection();

function createRuntime(
  { runtime, definition: sourceDefinition }: (typeof puzzleCatalog)[number],
  locale: AppLocale,
): PuzzleRuntime {
  const definition = localizePuzzleDefinition(sourceDefinition, locale);
  return {
    definition,
    evaluate: (inputs, operations) => evaluate(runtime, inputs, operations, locale),
    createGraph: (operations) => createGraph(runtime, operations, locale),
    createSources: (inputs) => createSources(definition, inputs),
  };
}

function evaluate(
  runtime: PuzzleRuntimeId,
  inputs: Readonly<Record<string, PreparedPuzzleInput>>,
  operations: PuzzleOperations,
  locale: AppLocale,
): PuzzleEvaluation {
  if (locale === 'zh-CN') {
    return localizeEvaluation(runtime, evaluate(runtime, inputs, operations, 'en'));
  }
  if (runtime === 'nfc-concatenation-boundary') {
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

  if (runtime === 'encoding-lengths') {
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

  if (runtime === 'grapheme-many-scalars') {
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

  if (runtime === 'case-fold-collision') {
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

  if (runtime === 'compatibility-normalization') {
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

  if (runtime === 'confusable-skeleton-collision') {
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
  }

  if (runtime === 'invisible-format-controls') {
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
  }

  if (runtime === 'malformed-utf16') {
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

  if (runtime === 'historical-normalization') {
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
  }

  throw new Error(`Unknown puzzle runtime ${runtime}.`);
}

function createGraph(
  runtime: PuzzleRuntimeId,
  operations: PuzzleOperations,
  locale: AppLocale,
): OperationGraph {
  if (locale === 'zh-CN') {
    return localizeGraph(runtime, createGraph(runtime, operations, 'en'));
  }
  if (runtime === 'nfc-concatenation-boundary') {
    return createNormalizationPuzzleGraph((input) => operations.normalize('NFC', input));
  }
  if (runtime === 'encoding-lengths') {
    return graph(
      [
        source('input', 'Input text', 'scalars'),
        scalarOperation(
          'utf8',
          'UTF-8 encode',
          'bytes',
          (input) => ({
            kind: 'bytes',
            value: utf8EncodeScalars(input),
          }),
          'Encodes every Unicode scalar into its variable-length UTF-8 byte sequence.',
        ),
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
          ([input]) => ({
            kind: 'count',
            value: requireUtf16Value(input).length,
          }),
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
  }
  if (runtime === 'grapheme-many-scalars') {
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
  }
  if (runtime === 'case-fold-collision') {
    return twoTransformGraph(
      'Default case fold',
      operations.caseFold,
      'Folds match',
      'Applies Unicode default full case folding for caseless comparison; this is not locale-specific lowercasing.',
      'Compares the two folded scalar sequences exactly.',
    );
  }
  if (runtime === 'compatibility-normalization') {
    return graph(
      [
        source('input', 'Input text', 'scalars'),
        scalarOperation(
          'nfc',
          'NFC',
          'scalars',
          (input) => ({
            kind: 'scalars',
            value: operations.normalize('NFC', input),
          }),
          'Applies canonical composition only, preserving compatibility distinctions.',
        ),
        scalarOperation(
          'nfkc',
          'NFKC',
          'scalars',
          (input) => ({
            kind: 'scalars',
            value: operations.normalize('NFKC', input),
          }),
          'Applies compatibility decomposition followed by canonical composition, so formatting variants may collapse.',
        ),
      ],
      [edge('input', 'nfc'), edge('input', 'nfkc')],
    );
  }
  if (runtime === 'confusable-skeleton-collision') {
    return twoTransformGraph(
      'UTS #39 skeleton',
      requireConfusableSkeleton(operations),
      'Skeletons match',
      'Computes the Unicode UTS #39 confusable skeleton used to detect visually deceptive identifiers.',
      'Compares the two confusable skeleton sequences exactly; matching does not imply semantic equivalence.',
    );
  }
  if (runtime === 'invisible-format-controls') {
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
  }
  if (runtime === 'malformed-utf16') {
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
          'Counts the supplied 16-bit code units without first decoding them as Unicode scalars.',
        ),
        unary(
          'valid',
          'Structurally valid',
          'utf16',
          'boolean',
          ([input]) => ({
            kind: 'boolean',
            value: isWellFormedUtf16(requireUtf16Value(input)),
          }),
          undefined,
          'Validates surrogate pairing without replacing or discarding malformed UTF-16 code units.',
        ),
      ],
      [edge('input', 'unit-length'), edge('input', 'valid')],
    );
  }
  if (runtime === 'historical-normalization') {
    const normalizeHistorical = requireHistoricalNormalizer(operations);
    return graph(
      [
        source('input', 'Input text', 'scalars'),
        scalarOperation(
          'unicode-15',
          'NFKC · Unicode 15.1',
          'scalars',
          (input) => ({
            kind: 'scalars',
            value: normalizeHistorical('NFKC', input),
          }),
          'Runs compatibility normalization with the separately pinned Unicode 15.1 engine.',
        ),
        scalarOperation(
          'unicode-17',
          'NFKC · Unicode 17',
          'scalars',
          (input) => ({
            kind: 'scalars',
            value: operations.normalize('NFKC', input),
          }),
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
  }
  throw new Error(`Unknown puzzle graph runtime ${runtime}.`);
}

type GraphNodeTranslation = readonly [label: string, explanation: string];

const chineseGraphNodes: Record<PuzzleRuntimeId, Record<string, GraphNodeTranslation>> = {
  'nfc-concatenation-boundary': {
    left: ['输入 A', '将输入的第一个字符串作为精确的 Unicode 标量序列提供给运算图。'],
    right: ['输入 B', '将输入的第二个字符串作为精确的 Unicode 标量序列提供给运算图。'],
    'left-nfc': ['NFC(A)', '使用当前 Unicode 引擎将输入 A 转换为规范组合形式（NFC）。'],
    'right-nfc': ['NFC(B)', '使用当前 Unicode 引擎将输入 B 转换为规范组合形式（NFC）。'],
    join: ['拼接 A + B', '把输入 B 的精确标量序列放在输入 A 之后，不对任一侧进行规范化。'],
    'joined-nfc': ['NFC(A + B)', '将拼接后的标量序列规范化为 NFC，使边界处的组合清晰可见。'],
    'joined-check': [
      'A + B 是 NFC',
      '比较拼接输入及其 NFC 结果；序列相等表示拼接结果原本就是 NFC。',
    ],
  },
  'encoding-lengths': {
    input: ['输入文本', '将输入文本作为 Unicode 标量序列提供给运算图。'],
    utf8: ['UTF-8 编码', '把每个 Unicode 标量值编码为变长 UTF-8 字节序列。'],
    'utf8-length': ['UTF-8 长度', '计算 UTF-8 编码产生的原始字节数。'],
    utf16: ['UTF-16 编码', '把标量序列编码为 UTF-16 码元；辅助平面标量会变成代理对。'],
    'utf16-length': ['UTF-16 长度', '计算 UTF-16 码元数，与 JavaScript 字符串 length 的语义一致。'],
    'scalar-length': [
      '标量值数量',
      '计算 Unicode 标量值数量，它不同于字节、UTF-16 码元和字素簇长度。',
    ],
  },
  'grapheme-many-scalars': {
    input: ['输入文本', '将输入文本作为 Unicode 标量序列提供给运算图。'],
    'scalar-length': [
      '标量值数量',
      '计算 Unicode 标量值数量，它不同于字节、UTF-16 码元和字素簇长度。',
    ],
    'grapheme-count': ['字素簇数量', '把序列分割为扩展字素簇，并计算用户感知的文本单位数量。'],
  },
  'case-fold-collision': {
    left: ['输入 A', '将输入 A 作为 Unicode 标量序列提供给运算图。'],
    right: ['输入 B', '将输入 B 作为 Unicode 标量序列提供给运算图。'],
    'left-result': [
      '默认大小写折叠(A)',
      '应用 Unicode 默认完整大小写折叠；这不是特定语言环境的小写转换。',
    ],
    'right-result': [
      '默认大小写折叠(B)',
      '应用 Unicode 默认完整大小写折叠；这不是特定语言环境的小写转换。',
    ],
    compare: ['折叠结果匹配', '精确比较两个折叠后的标量序列。'],
  },
  'compatibility-normalization': {
    input: ['输入文本', '将输入文本作为 Unicode 标量序列提供给运算图。'],
    nfc: ['NFC', '只应用规范组合，保留兼容性差异。'],
    nfkc: ['NFKC', '先兼容分解再规范组合，因此显示形式的变体可能会合并。'],
  },
  'confusable-skeleton-collision': {
    left: ['输入 A', '将输入 A 作为 Unicode 标量序列提供给运算图。'],
    right: ['输入 B', '将输入 B 作为 Unicode 标量序列提供给运算图。'],
    'left-result': ['UTS #39 骨架(A)', '计算用于发现视觉欺骗标识符的 Unicode UTS #39 易混淆骨架。'],
    'right-result': [
      'UTS #39 骨架(B)',
      '计算用于发现视觉欺骗标识符的 Unicode UTS #39 易混淆骨架。',
    ],
    compare: ['骨架匹配', '精确比较两个易混淆骨架；匹配并不表示语义等价。'],
  },
  'invisible-format-controls': {
    input: ['输入文本', '将输入文本作为 Unicode 标量序列提供给运算图。'],
    'scalar-length': [
      '标量值数量',
      '计算 Unicode 标量值数量，它不同于字节、UTF-16 码元和字素簇长度。',
    ],
    'format-check': [
      '仅含格式字符',
      '检查非空输入是否完全由 Unicode General_Category=Cf 格式控制字符组成。',
    ],
  },
  'malformed-utf16': {
    input: ['原始 UTF-16 码元', '将原始 UTF-16 码元直接提供给运算图，包括未配对代理项。'],
    'unit-length': ['码元数量', '直接计算提供的 16 位码元，不先将它们解码为 Unicode 标量值。'],
    valid: ['结构有效', '验证代理项配对关系，不替换或丢弃格式错误的 UTF-16 码元。'],
  },
  'historical-normalization': {
    input: ['输入文本', '将输入文本作为 Unicode 标量序列提供给运算图。'],
    'unicode-15': ['NFKC · Unicode 15.1', '使用独立固定版本的 Unicode 15.1 引擎执行兼容规范化。'],
    'unicode-17': ['NFKC · Unicode 17', '使用当前固定版本的 Unicode 17 引擎执行兼容规范化。'],
    compare: ['结果不同', '精确比较两个版本的规范化结果，以揭示真实的 Unicode 版本差异。'],
  },
};

const chineseEvaluationText: Readonly<Record<string, string>> = {
  'Target reached': '已达到目标',
  'Keep exploring': '继续探索',
  'Input A is NFC': '输入 A 是 NFC',
  'Input B is NFC': '输入 B 是 NFC',
  'Join changes under NFC': '拼接结果经 NFC 会改变',
  Empty: '空',
  'Needs NFC': '需要 NFC',
  Entered: '输入值',
  'After NFC': 'NFC 后',
  'Unicode scalars': 'Unicode 标量值',
  'Grapheme clusters': '字素簇',
  'UTF-16 units': 'UTF-16 码元',
  'UTF-8 bytes': 'UTF-8 字节',
  'Scalar value': '标量值',
  Storage: '存储',
  'Both non-empty': '两者均非空',
  'Inputs differ': '输入不同',
  'Case folds match': '大小写折叠结果匹配',
  Folded: '已折叠',
  'Input A fold': '输入 A 的折叠结果',
  'Input B fold': '输入 B 的折叠结果',
  'Non-empty': '非空',
  'NFC unchanged': 'NFC 不改变',
  'NFKC changes': 'NFKC 会改变',
  'NFC stable': 'NFC 稳定',
  'NFC changes': 'NFC 会改变',
  'After NFKC': 'NFKC 后',
  'Skeletons match': '骨架匹配',
  'NFC forms differ': 'NFC 形式不同',
  'Skeleton ready': '骨架就绪',
  'Input A': '输入 A',
  'Input B': '输入 B',
  'Every category is Cf': '所有类别均为 Cf',
  'Code points': '码位',
  Categories: '类别',
  'Valid UTF-16': '有效 UTF-16',
  'Unpaired surrogate': '未配对代理项',
  'Structurally malformed': '结构错误',
  'Well-formed': '结构良好',
  Malformed: '格式错误',
  'Code units': '码元',
  Validation: '验证结果',
  'Well-formed UTF-16': '结构良好的 UTF-16',
  'One scalar': '一个标量值',
  '15.1 NFKC unchanged': '15.1 NFKC 不改变',
  '17 NFKC changes': '17 NFKC 会改变',
  'Current result is ASCII': '当前结果为 ASCII',
  'Profiles differ': '版本结果不同',
  'Same result': '结果相同',
  Yes: '是',
  No: '否',
  'Empty sequence': '空序列',
  'Case folds differ': '大小写折叠结果不同',
  'Skeletons differ': '骨架不同',
};

function localizeEvaluation(_runtime: PuzzleRuntimeId, result: PuzzleEvaluation): PuzzleEvaluation {
  return {
    ...result,
    code: localizeEvaluationValue(result.code),
    status: localizeEvaluationValue(result.status),
    checks: result.checks.map((item) => ({
      ...item,
      label: localizeEvaluationValue(item.label),
      value: localizeEvaluationValue(item.value),
    })),
    inputStatuses: Object.fromEntries(
      Object.entries(result.inputStatuses).map(([id, item]) => [
        id,
        { ...item, label: localizeEvaluationValue(item.label) },
      ]),
    ),
    details: result.details.map((item) => ({
      label: localizeEvaluationValue(item.label),
      value: localizeEvaluationValue(item.value),
    })),
  };
}

function localizeEvaluationValue(value: string): string {
  const exact = chineseEvaluationText[value];
  if (exact) return exact;
  const scalarCount = value.match(/^(\d+) scalars?$/);
  if (scalarCount) return `${scalarCount[1]} 个标量值`;
  const graphemeCount = value.match(/^(\d+) grapheme$/);
  if (graphemeCount) return `${graphemeCount[1]} 个字素簇`;
  const storage = value.match(/^(\d+) UTF-8 bytes · (\d+) UTF-16 units$/);
  if (storage) return `${storage[1]} 个 UTF-8 字节 · ${storage[2]} 个 UTF-16 码元`;
  const measures = value.match(/^(\d+) grapheme · (\d+) scalars$/);
  if (measures) return `${measures[1]} 个字素簇 · ${measures[2]} 个标量值`;
  return value;
}

function localizeGraph(runtime: PuzzleRuntimeId, sourceGraph: OperationGraph): OperationGraph {
  const translations = chineseGraphNodes[runtime];
  return {
    ...sourceGraph,
    nodes: sourceGraph.nodes.map((node) => {
      const translation = translations[node.id];
      return translation
        ? {
            ...node,
            label: translation[0],
            explanation: translation[1],
            outputUnit: localizeOutputUnit(node.outputUnit),
          }
        : node;
    }),
  };
}

function localizeOutputUnit(unit: string | undefined): string | undefined {
  if (!unit) return unit;
  return { bytes: '字节', units: '码元', scalars: '标量值', graphemes: '字素簇' }[unit] ?? unit;
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
  transformExplanation: string,
  comparisonExplanation: string,
): OperationGraph {
  return graph(
    [
      source('left', 'Input A', 'scalars'),
      source('right', 'Input B', 'scalars'),
      scalarOperation(
        'left-result',
        `${transformLabel}(A)`,
        'scalars',
        (input) => ({
          kind: 'scalars',
          value: transform(input),
        }),
        transformExplanation,
      ),
      scalarOperation(
        'right-result',
        `${transformLabel}(B)`,
        'scalars',
        (input) => ({
          kind: 'scalars',
          value: transform(input),
        }),
        transformExplanation,
      ),
      {
        id: 'compare',
        label: comparisonLabel,
        explanation: comparisonExplanation,
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

function graph(nodes: OperationNode[], edges: OperationGraph['edges']): OperationGraph {
  return { nodes, edges };
}

function source(id: string, label: string, outputKind: OperationNode['outputKind']): OperationNode {
  return {
    id,
    label,
    explanation: `Supplies ${label.toLowerCase()} to the graph as ${outputKind}.`,
    inputKinds: [],
    outputKind,
  };
}

function unary(
  id: string,
  label: string,
  inputKind: OperationNode['outputKind'],
  outputKind: OperationNode['outputKind'],
  execute: NonNullable<OperationNode['execute']>,
  outputUnit?: string,
  explanation = `Transforms ${inputKind} input into ${outputKind} output.`,
): OperationNode {
  return { id, label, explanation, inputKinds: [inputKind], outputKind, outputUnit, execute };
}

function scalarOperation(
  id: string,
  label: string,
  outputKind: OperationNode['outputKind'],
  execute: (input: Uint32Array) => OperationValue,
  explanation?: string,
): OperationNode {
  return unary(
    id,
    label,
    'scalars',
    outputKind,
    ([input]) => execute(requireScalarsValue(input)),
    undefined,
    explanation,
  );
}

function scalarCountNode(id: string): OperationNode {
  return unary(
    id,
    'Scalar count',
    'scalars',
    'count',
    ([input]) => ({ kind: 'count', value: requireScalarsValue(input).length }),
    'scalars',
    'Counts Unicode scalar values. This differs from byte, UTF-16 code-unit, and grapheme-cluster length.',
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

function requireHistoricalNormalizer(
  operations: PuzzleOperations,
): NonNullable<PuzzleOperations['normalizeHistorical']> {
  if (!operations.normalizeHistorical) {
    throw new Error('The historical normalization engine is not loaded.');
  }
  return operations.normalizeHistorical;
}

function requireConfusableSkeleton(
  operations: PuzzleOperations,
): NonNullable<PuzzleOperations['confusableSkeleton']> {
  if (!operations.confusableSkeleton) {
    throw new Error('This puzzle requires the Unicode confusable index.');
  }
  return operations.confusableSkeleton;
}

function requireGeneralCategory(
  operations: PuzzleOperations,
): NonNullable<PuzzleOperations['generalCategory']> {
  if (!operations.generalCategory) {
    throw new Error('This puzzle requires the Unicode property index.');
  }
  return operations.generalCategory;
}
