import vue from '@vitejs/plugin-vue'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const revisionModule = 'virtual:unicodd-logic-revision'
const revisionId = '\0' + revisionModule
const root = new URL('./src/lib/', import.meta.url)
// Bump this when journal recording changes its contract with replayJournal.
const journalVersion = '1'
const logicFiles = [
  ...readdirSync(root).filter((name) => name.endsWith('.ts')),
  'wasm/pkg/unicodd_core.js',
  'wasm/pkg/unicodd_core_bg.wasm',
].sort()
const logicPaths = logicFiles.map((name) => fileURLToPath(new URL(name, root)))
// The previous fingerprint included SFC bytes, so bridge that known build only
// while the journal contract and hashed logic/WASM match this upgrade.
const upgradeLogic = '22ef1239a0abd2f651f7fa4c41e59cc542ad3e01f20337c3eb10eafbdf47b285'
const previousLogic = '5496bcd0897ddbbb7d42c63d8557ebe472d4e280292cd52b897a17648a574636'

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
        const logic = hash.digest('hex')
        const compatible =
          journalVersion === '1' && logic === upgradeLogic ? previousLogic : undefined
        return `
          export default ${JSON.stringify(journalVersion + ':' + logic)};
          export const previousRevision = ${JSON.stringify(compatible)};
        `
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
