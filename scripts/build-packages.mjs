import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { build } from 'vite-plus'

const repoRoot = path.resolve(import.meta.dirname, '..')

const publicOutDir = path.join(repoRoot, 'packages', 'irisout', 'dist')
const declarationOutDir = path.join(repoRoot, 'packages', 'irisout', '.types')
rmSync(publicOutDir, { recursive: true, force: true })
rmSync(declarationOutDir, { recursive: true, force: true })
mkdirSync(publicOutDir, { recursive: true })

const publicEntries = [
  {
    name: 'runtime',
    source: 'packages/runtime/src/index.ts',
    external: (id) => id.startsWith('node:') || id.includes('runtime/src/index'),
    paths: (id) => (id.includes('runtime/src/index') ? './runtime.js' : id),
  },
  {
    name: 'index',
    source: 'packages/compiler/src/compiler.ts',
    external: (id) => id.startsWith('node:'),
    paths: {},
  },
  {
    name: 'diagnostics',
    source: 'packages/compiler/src/diagnostics.ts',
    external: (id) => id.startsWith('node:'),
    paths: {},
  },
  {
    name: 'state',
    source: 'packages/compiler/src/compiler/state.ts',
    external: (id) => id.startsWith('node:'),
    paths: {},
  },
  {
    name: 'vite',
    source: 'packages/vite-plugin/src/index.ts',
    external: (id) =>
      id === 'vite-plus' || id.startsWith('node:') || id.includes('compiler/src/compiler'),
    paths: (id) => (id.includes('compiler/src/compiler') ? './index.js' : id),
  },
]

for (const entry of publicEntries) {
  await build({
    configFile: false,
    root: repoRoot,
    build: {
      outDir: publicOutDir,
      emptyOutDir: false,
      lib: {
        entry: path.join(repoRoot, entry.source),
        formats: ['es'],
        fileName: entry.name,
      },
      rollupOptions: { external: entry.external, output: { paths: entry.paths } },
    },
  })
}

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/tsc'),
  [
    '--declaration',
    '--emitDeclarationOnly',
    '--allowImportingTsExtensions',
    '--esModuleInterop',
    '--isolatedModules',
    '--lib',
    'ES2022,DOM,DOM.Iterable',
    '--target',
    'ES2022',
    '--module',
    'ESNext',
    '--moduleResolution',
    'bundler',
    '--outDir',
    declarationOutDir,
    '--rootDir',
    path.join(repoRoot, 'packages'),
    '--skipLibCheck',
    '--strict',
    ...publicEntries.map((entry) => path.join(repoRoot, entry.source)),
  ],
  { cwd: repoRoot, stdio: 'inherit' },
)

copyFileSync(
  path.join(declarationOutDir, 'compiler/src/compiler.d.ts'),
  path.join(publicOutDir, 'index.d.ts'),
)
copyFileSync(
  path.join(declarationOutDir, 'runtime/src/index.d.ts'),
  path.join(publicOutDir, 'runtime.d.ts'),
)
copyFileSync(
  path.join(declarationOutDir, 'vite-plugin/src/index.d.ts'),
  path.join(publicOutDir, 'vite.d.ts'),
)
copyFileSync(
  path.join(declarationOutDir, 'compiler/src/diagnostics.d.ts'),
  path.join(publicOutDir, 'diagnostics.d.ts'),
)
copyFileSync(
  path.join(repoRoot, 'packages/compiler/types/jsx.d.ts'),
  path.join(publicOutDir, 'jsx.d.ts'),
)
copyFileSync(path.join(repoRoot, 'LICENSE'), path.join(publicOutDir, 'LICENSE'))
cpSync(path.join(declarationOutDir, 'compiler/src/compiler'), path.join(publicOutDir, 'compiler'), {
  recursive: true,
})
rmSync(declarationOutDir, { recursive: true, force: true })
if (!existsSync(publicOutDir)) throw new Error('missing package output: irisout')

console.log('package bundles and declarations built')
