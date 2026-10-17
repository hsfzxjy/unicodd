import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = resolve(repositoryRoot, 'crates/unicodd-ops-core/Cargo.toml');
const source = resolve(
  repositoryRoot,
  'target/wasm32-unknown-unknown/release/unicodd_ops_core.wasm',
);
const destination = resolve(repositoryRoot, 'public/wasm/unicodd_ops_core.wasm');

execFileSync(
  'cargo',
  ['build', '--manifest-path', manifest, '--target', 'wasm32-unknown-unknown', '--release'],
  { cwd: repositoryRoot, stdio: 'inherit' },
);

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.log(`WASM ready: ${destination}`);
