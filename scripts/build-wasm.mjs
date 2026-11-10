import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../', import.meta.url))
const version = '0.2.130'
const bindgen = execFileSync('wasm-bindgen', ['--version'], { cwd, encoding: 'utf8' }).trim()
if (bindgen !== `wasm-bindgen ${version}`) {
  throw new Error(
    `Install the matching CLI with cargo install wasm-bindgen-cli --version ${version} --locked`,
  )
}
const target = 'wasm32-unknown-unknown'
execFileSync(
  'cargo',
  [
    'build',
    '--locked',
    '--release',
    '-p',
    'unicodd-core',
    '--target',
    target,
    '--target-dir',
    'target',
  ],
  {
    cwd,
    stdio: 'inherit',
  },
)
execFileSync(
  'wasm-bindgen',
  [
    `target/${target}/release/unicodd_core.wasm`,
    '--target',
    'web',
    '--out-dir',
    'src/lib/wasm/pkg',
  ],
  { cwd, stdio: 'inherit' },
)
