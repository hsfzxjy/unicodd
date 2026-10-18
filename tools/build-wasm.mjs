import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const engines = [
  {
    manifest: 'crates/unicodd-ops-core/Cargo.toml',
    source: 'target/wasm32-unknown-unknown/release/unicodd_ops_core.wasm',
    destination: 'public/wasm/unicodd_ops_core.wasm',
  },
  {
    manifest: 'crates/unicode-15/Cargo.toml',
    source: 'crates/unicode-15/target/wasm32-unknown-unknown/release/unicodd_unicode_15.wasm',
    destination: 'public/wasm/unicodd_unicode_15.wasm',
  },
];

for (const engine of engines) {
  const manifest = resolve(repositoryRoot, engine.manifest);
  const source = resolve(repositoryRoot, engine.source);
  const destination = resolve(repositoryRoot, engine.destination);

  execFileSync(
    'cargo',
    ['build', '--manifest-path', manifest, '--target', 'wasm32-unknown-unknown', '--release'],
    { cwd: repositoryRoot, stdio: 'inherit' },
  );
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  console.log(`WASM ready: ${destination}`);
}
