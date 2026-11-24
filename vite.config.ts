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
// The case progress projection is read-only. This build can replay the preceding build's journals.
const upgradeLogic = '42b54f4266de91fdaf855344824882d7050f86a6d57a93d441be8d2305042d0f'
// These exact builds preserve the actions and effects recorded in journals.
const reportLogic = new Set([
  'f2b7a60c24406258e7ef260fa28d6aa3240e9c4c66798f4bfe0a9553a1cabc8b',
  'afece4d55f7b99da893b18e932f70d0234f5c80326e27a5db23965d73937de82',
  '71a70c28132d71d870a4d5259a4574b34d6fe94963d2609d0d8a019e280a511d',
  '1813df35becadb97b60a943ec6c9c02eb32ceb33649d2d28309fc3109b108cc8',
  'f615186fcf299e013022178554912b9c515923d591bab162e87f0e43693b8a90',
])
const previousLogic = '1:ee9e6afa21b7afb1b1e595944d90b15d35b254a3398c2dfbcded0c55ade1eef6'

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
        const digest = hash.digest('hex')
        const logic = journalVersion === '1' && reportLogic.has(digest) ? upgradeLogic : digest
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
