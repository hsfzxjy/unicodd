import vue from '@vitejs/plugin-vue'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const revisionModule = 'virtual:unicodd-logic-revision'
const revisionId = '\0' + revisionModule
const root = new URL('./src/lib/', import.meta.url)
const logicFiles = [
  ...readdirSync(root).filter((name) => name.endsWith('.ts')),
  'wasm/pkg/unicodd_core.js',
  'wasm/pkg/unicodd_core_bg.wasm',
  '../App.vue',
  '../components/CommandComposer.vue',
].sort()
const logicPaths = logicFiles.map((name) => fileURLToPath(new URL(name, root)))

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'unicodd-logic-revision',
      resolveId: (id) => (id === revisionModule ? revisionId : undefined),
      load(id) {
        if (id !== revisionId) return
        const hash = createHash('sha256')
        for (const [index, path] of logicPaths.entries()) {
          this.addWatchFile(path)
          hash.update(logicFiles[index]).update('\0').update(readFileSync(path))
        }
        return `export default ${JSON.stringify(hash.digest('hex'))}`
      },
      handleHotUpdate({ file, server }) {
        if (!logicPaths.some((path) => path.replaceAll('\\', '/') === file)) return
        const module = server.moduleGraph.getModuleById(revisionId)
        if (!module) return
        server.moduleGraph.invalidateModule(module)
        server.ws.send({ type: 'full-reload' })
        return []
      },
    },
  ],
  server: {
    fs: {
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem,key,p12,pfx,cer,der}',
        '.npmrc',
        '.yarnrc.yml',
        '**/.git/**',
        '**/.codex-remote-attachments/**',
        '**/private/**',
        '**/tests/**',
      ],
    },
  },
})
