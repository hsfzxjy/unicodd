import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const budgets = [
  {
    label: 'Application JavaScript',
    directory: 'dist/assets',
    extension: '.js',
    maxBytes: 450_000,
    reportGzip: true,
  },
  {
    label: 'Application CSS',
    directory: 'dist/assets',
    extension: '.css',
    maxBytes: 40_000,
    reportGzip: true,
  },
  {
    label: 'Current Unicode WASM',
    path: 'dist/wasm/unicodd_ops_core.wasm',
    maxBytes: 1_050_000,
  },
  {
    label: 'Historical Unicode WASM',
    path: 'dist/wasm/unicodd_unicode_15.wasm',
    maxBytes: 150_000,
  },
  {
    label: 'Relationship index',
    path: 'dist/unicode-indexes/relationships-17.0.0.json',
    maxBytes: 1_250_000,
  },
  {
    label: 'Unicode name index',
    path: 'dist/unicode-indexes/names-17.0.0.json',
    maxBytes: 6_200_000,
  },
];

function parseRoot(args) {
  if (args.length === 0) return process.cwd();
  if (args.length === 2 && args[0] === '--root') return resolve(args[1]);
  throw new Error('Usage: node tools/check-size-budget.mjs [--root <build-root>]');
}

function collectFiles(root, budget) {
  if ('path' in budget) {
    const absolutePath = resolve(root, budget.path);
    return statSync(absolutePath).isFile() ? [absolutePath] : [];
  }

  const directory = resolve(root, budget.directory);
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name) === budget.extension)
    .map((entry) => resolve(directory, entry.name))
    .sort();
}

function formatBytes(bytes) {
  return `${bytes.toLocaleString('en-US')} B (${(bytes / 1000).toFixed(2)} kB)`;
}

function describeFiles(root, files) {
  return files.map((file) => relative(root, file).replaceAll('\\', '/')).join(', ');
}

function checkBudget(root, budget) {
  let files;
  try {
    files = collectFiles(root, budget);
  } catch (error) {
    return {
      passed: false,
      message: `FAIL ${budget.label}: expected build output is missing (${error.message})`,
    };
  }

  if (files.length === 0) {
    const expected = 'path' in budget ? budget.path : `${budget.directory}/*${budget.extension}`;
    return {
      passed: false,
      message: `FAIL ${budget.label}: no files matched ${expected}; run npm run build first`,
    };
  }

  const contents = files.map((file) => readFileSync(file));
  const size = contents.reduce((sum, content) => sum + content.byteLength, 0);
  const difference = budget.maxBytes - size;
  const status = difference >= 0 ? 'PASS' : 'FAIL';
  const margin =
    difference >= 0
      ? `${formatBytes(difference)} remaining`
      : `${formatBytes(Math.abs(difference))} over budget`;
  const gzip = budget.reportGzip
    ? `; gzip ${formatBytes(gzipSync(Buffer.concat(contents)).byteLength)}`
    : '';

  return {
    passed: difference >= 0,
    message: `${status} ${budget.label}: ${formatBytes(size)} / ${formatBytes(
      budget.maxBytes,
    )}; ${margin}${gzip}; ${describeFiles(root, files)}`,
  };
}

let root;
try {
  root = parseRoot(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}

if (root) {
  console.log(`Size budget report: ${root}`);
  const results = budgets.map((budget) => checkBudget(root, budget));
  for (const result of results) console.log(result.message);
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}
