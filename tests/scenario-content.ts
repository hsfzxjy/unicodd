import { readFile } from 'node:fs/promises'
import { createContentLoader } from '../src/lib/content'
import { createEngine } from '../src/lib/engine'

export const engine = createEngine(async () => {
  const module = await import('../src/lib/wasm/pkg/unicodd_core.js')
  const binary = await readFile(
    new URL('../src/lib/wasm/pkg/unicodd_core_bg.wasm', import.meta.url),
  )
  await module.default({ module_or_path: binary })
  return module
})

export const productionRoot = new URL('../public/content/', import.meta.url)
export const fixtureRoot = new URL('./fixtures/content/', import.meta.url)
export const readProduction = (path: string) => readFile(new URL(path, productionRoot))
export const production = createContentLoader(readProduction, engine)
export const fixtures = createContentLoader((path) => readFile(new URL(path, fixtureRoot)), engine)
