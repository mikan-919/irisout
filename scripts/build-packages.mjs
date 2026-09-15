import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    name: 'browser',
    source: 'packages/compiler/src/browser.ts',
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
  {
    name: 'ssr',
    source: 'packages/vite-plugin/src/ssr.ts',
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
  path.join(declarationOutDir, 'compiler/src/browser.d.ts'),
  path.join(publicOutDir, 'browser.d.ts'),
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
  path.join(declarationOutDir, 'vite-plugin/src/ssr.d.ts'),
  path.join(publicOutDir, 'ssr.d.ts'),
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

// 公開入口から到達する宣言だけを梱包する。解析用の宣言一式を配ると、
// CompilerState経由で内部Babel型を利用者へ要求するためである。
const publicCompilerOutDir = path.join(publicOutDir, 'compiler')
mkdirSync(publicCompilerOutDir, { recursive: true })
copyFileSync(
  path.join(declarationOutDir, 'compiler/src/compiler/source.d.ts'),
  path.join(publicCompilerOutDir, 'source.d.ts'),
)
copyFileSync(
  path.join(repoRoot, 'packages/compiler/types/state.d.ts'),
  path.join(publicCompilerOutDir, 'state.d.ts'),
)
copyFileSync(
  path.join(declarationOutDir, 'compiler/src/source-map.d.ts'),
  path.join(publicOutDir, 'source-map.d.ts'),
)

const declarationFiles = [
  'index.d.ts',
  'browser.d.ts',
  'runtime.d.ts',
  'vite.d.ts',
  'ssr.d.ts',
  'diagnostics.d.ts',
  'jsx.d.ts',
  'source-map.d.ts',
  'compiler/source.d.ts',
  'compiler/state.d.ts',
]
for (const relativePath of declarationFiles) {
  const declarationPath = path.join(publicOutDir, relativePath)
  const declaration = readFileSync(declarationPath, 'utf8').replace(
    /(['"])(\.\.?\/[^'"]+)\1/g,
    (match, quote, specifier) =>
      specifier.endsWith('.ts') && !specifier.endsWith('.d.ts')
        ? `${quote}${specifier.slice(0, -3)}.js${quote}`
        : match,
  )
  writeFileSync(declarationPath, declaration)
}
rmSync(declarationOutDir, { recursive: true, force: true })
if (!existsSync(publicOutDir)) throw new Error('missing package output: irisout')

console.log('package bundles and declarations built')
