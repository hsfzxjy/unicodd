import type { OperationGraph } from '../../engine/types';
import type { AppLocale } from '../../i18n';
import type { PuzzleRuntimeId } from '../catalog';
import type { PuzzleEvaluation } from '../types';

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

interface EvaluationTranslation {
  checks: readonly string[];
  details: readonly string[];
}

const chineseEvaluationCopy: Record<PuzzleRuntimeId, EvaluationTranslation> = {
  'nfc-concatenation-boundary': {
    checks: ['输入 A 是 NFC', '输入 B 是 NFC', '拼接结果经 NFC 会改变'],
    details: ['输入值', 'NFC 后'],
  },
  'encoding-lengths': {
    checks: ['Unicode 标量值', '字素簇', 'UTF-16 码元', 'UTF-8 字节'],
    details: ['标量值', '存储'],
  },
  'grapheme-many-scalars': {
    checks: ['字素簇', 'Unicode 标量值'],
    details: ['字素簇', '度量'],
  },
  'case-fold-collision': {
    checks: ['两者均非空', '输入不同', '大小写折叠结果匹配'],
    details: ['输入 A 的折叠结果', '输入 B 的折叠结果'],
  },
  'compatibility-normalization': {
    checks: ['非空', 'NFC 不改变', 'NFKC 会改变'],
    details: ['输入值', 'NFKC 后'],
  },
  'confusable-skeleton-collision': {
    checks: ['输入不同', '骨架匹配', 'NFC 形式不同'],
    details: ['输入 A', '输入 B'],
  },
  'invisible-format-controls': {
    checks: ['非空', '所有类别均为 Cf'],
    details: ['码位', '类别'],
  },
  'malformed-utf16': {
    checks: ['非空', '结构错误'],
    details: ['码元', '验证结果'],
  },
  'historical-normalization': {
    checks: ['一个标量值', '15.1 NFKC 不改变', '17 NFKC 会改变', '当前结果为 ASCII'],
    details: ['Unicode 15.1 NFKC', 'Unicode 17 NFKC'],
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
  Cluster: '字素簇',
  Measures: '度量',
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

export function localizeEvaluation(
  runtime: PuzzleRuntimeId,
  locale: AppLocale,
  result: PuzzleEvaluation,
): PuzzleEvaluation {
  if (locale === 'en') return result;
  const copy = chineseEvaluationCopy[runtime];
  if (
    copy.checks.length !== result.checks.length ||
    copy.details.length !== result.details.length
  ) {
    throw new Error(`Chinese evaluation copy does not match runtime “${runtime}”.`);
  }
  return {
    ...result,
    code: localizeEvaluationValue(result.code),
    status: localizeEvaluationValue(result.status),
    checks: result.checks.map((item, index) => ({
      ...item,
      label: copy.checks[index]!,
      value: localizeEvaluationValue(item.value),
    })),
    inputStatuses: Object.fromEntries(
      Object.entries(result.inputStatuses).map(([id, item]) => [
        id,
        { ...item, label: localizeEvaluationValue(item.label) },
      ]),
    ),
    details: result.details.map((item, index) => ({
      label: copy.details[index]!,
      value: localizeEvaluationValue(item.value),
    })),
  };
}

export function localizeGraph(
  runtime: PuzzleRuntimeId,
  locale: AppLocale,
  sourceGraph: OperationGraph,
): OperationGraph {
  if (locale === 'en') return sourceGraph;
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

function localizeOutputUnit(unit: string | undefined): string | undefined {
  if (!unit) return unit;
  return { bytes: '字节', units: '码元', scalars: '标量值', graphemes: '字素簇' }[unit] ?? unit;
}
