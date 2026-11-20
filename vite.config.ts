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
// Replay the preceding build's journals with the new transcript presentation metadata.
const upgradeLogic = '44d423b425f2a3aa9aa24167c86879bb19ffc7bb634e37689a2d1fd0a9d8e0fb'
const previousLogic = '1:de93be50d744f7f7a11ddff4e3ca1b8193cdb862e36e38774da0abcbe3bc5c68'

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
