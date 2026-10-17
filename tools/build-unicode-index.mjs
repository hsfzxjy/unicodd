import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputDirectory = resolve(repositoryRoot, 'tools/unicode-data/17.0.0');
const outputDirectory = resolve(repositoryRoot, 'public/unicode-indexes');
const outputs = [
  resolve(outputDirectory, 'relationships-17.0.0.json'),
  resolve(outputDirectory, 'names-17.0.0.json'),
];
const sources = [
  resolve(inputDirectory, 'UnicodeData.txt'),
  resolve(inputDirectory, 'Scripts.txt'),
  resolve(inputDirectory, 'DerivedAge.txt'),
  resolve(inputDirectory, 'CaseFolding.txt'),
  resolve(inputDirectory, 'confusables.txt'),
  resolve(repositoryRoot, 'tools/unicode-indexer/src/main.rs'),
  resolve(repositoryRoot, 'tools/unicode-indexer/Cargo.toml'),
];

function modificationTime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

const outputTime = Math.min(...outputs.map(modificationTime));
const newestSourceTime = Math.max(...sources.map(modificationTime));

if (outputTime >= newestSourceTime) {
  console.log(`Unicode indexes are current: ${outputDirectory}`);
  process.exit(0);
}

mkdirSync(outputDirectory, { recursive: true });
execFileSync(
  'cargo',
  ['run', '--quiet', '-p', 'unicode-indexer', '--', inputDirectory, outputDirectory],
  { cwd: repositoryRoot, stdio: 'inherit' },
);
