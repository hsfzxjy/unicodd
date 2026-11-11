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
const profile = 'wasm'
execFileSync(
  'cargo',
  [
    'build',
    '--locked',
    '--profile',
    profile,
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
    `target/${target}/${profile}/unicodd_core.wasm`,
    '--target',
    'web',
    '--remove-name-section',
    '--out-dir',
    'src/lib/wasm/pkg',
  ],
  { cwd, stdio: 'inherit' },
)
