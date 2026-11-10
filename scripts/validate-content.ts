import { readFile } from 'node:fs/promises'
import { createContentLoader } from '../src/lib/content.ts'
import { createEngine } from '../src/lib/engine.ts'

const engine = createEngine(async () => {
  const module = await import('../src/lib/wasm/pkg/unicodd_core.js')
  const binary = await readFile(
    new URL('../src/lib/wasm/pkg/unicodd_core_bg.wasm', import.meta.url),
  )
  await module.default({ module_or_path: binary })
  return module
})
const content = createContentLoader(
  (path) => readFile(new URL(path, new URL('../public/content/', import.meta.url))),
  engine,
)

try {
  const info = await engine.info()
  if (!info.ok) throw new Error('Could not load the evaluator. Run npm run build:wasm and retry.')
  const scenarios = await content.manifest()
  for (const entry of scenarios) {
    try {
      await content.scenario(entry)
      console.log(`OK ${entry.id}`)
    } catch (error) {
      console.error(`${entry.id} — ${(error as Error).message}`)
      process.exitCode = 1
    }
  }
  if (!process.exitCode) console.log(`Validated ${scenarios.length} scenario(s).`)
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
}
