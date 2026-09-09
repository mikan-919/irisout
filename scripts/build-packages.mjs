import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { build } from 'vite-plus'

const repoRoot = path.resolve(import.meta.dirname, '..')

const packages = [
  {
    name: 'runtime',
    entries: [{ name: 'index', source: 'packages/runtime/src/index.ts' }],
    external: () => false,
  },
  {
    name: 'compiler',
    entries: [
      { name: 'compiler', source: 'packages/compiler/src/compiler.ts' },
      { name: 'diagnostics', source: 'packages/compiler/src/diagnostics.ts' },
      { name: 'state', source: 'packages/compiler/src/compiler/state.ts' },
    ],
    external: (id) => id === '@irisout/runtime' || id.startsWith('node:'),
  },
  {
    name: 'vite-plugin',
    entries: [{ name: 'index', source: 'packages/vite-plugin/src/index.ts' }],
    external: (id) => id === '@irisout/compiler' || id === 'vite-plus' || id.startsWith('node:'),
  },
]

for (const packageInfo of packages) {
  const outDir = path.join(repoRoot, 'packages', packageInfo.name, 'dist')
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  for (const entry of packageInfo.entries) {
    await build({
      configFile: false,
      root: repoRoot,
      build: {
        outDir,
        emptyOutDir: false,
        lib: {
          entry: path.join(repoRoot, entry.source),
          formats: ['es'],
          fileName: entry.name,
        },
        rollupOptions: { external: packageInfo.external },
      },
    })
  }

  const declarationOutDir = outDir
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
      path.join(repoRoot, 'packages', packageInfo.name, 'src'),
      '--skipLibCheck',
      '--strict',
      ...packageInfo.entries.map((entry) => path.join(repoRoot, entry.source)),
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  )
}

const publicOutDir = path.join(repoRoot, 'packages', 'irisout', 'dist')
rmSync(publicOutDir, { recursive: true, force: true })
mkdirSync(publicOutDir, { recursive: true })

const publicEntries = [
  {
    name: 'runtime',
    source: 'packages/runtime/src/index.ts',
    external: (id) => id.startsWith('node:'),
    paths: {},
  },
  {
    name: 'index',
    source: 'packages/compiler/src/compiler.ts',
    external: (id) => id === '@irisout/runtime' || id.startsWith('node:'),
    paths: { '@irisout/runtime': './runtime.js' },
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
    external: (id) => id === '@irisout/compiler' || id === 'vite-plus' || id.startsWith('node:'),
    paths: { '@irisout/compiler': './index.js' },
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

copyFileSync(
  path.join(repoRoot, 'packages/compiler/dist/compiler.d.ts'),
  path.join(publicOutDir, 'index.d.ts'),
)
copyFileSync(
  path.join(repoRoot, 'packages/runtime/dist/index.d.ts'),
  path.join(publicOutDir, 'runtime.d.ts'),
)
copyFileSync(
  path.join(repoRoot, 'packages/vite-plugin/dist/index.d.ts'),
  path.join(publicOutDir, 'vite.d.ts'),
)
copyFileSync(
  path.join(repoRoot, 'packages/compiler/dist/diagnostics.d.ts'),
  path.join(publicOutDir, 'diagnostics.d.ts'),
)
copyFileSync(
  path.join(repoRoot, 'packages/compiler/types/jsx.d.ts'),
  path.join(publicOutDir, 'jsx.d.ts'),
)
copyFileSync(path.join(repoRoot, 'LICENSE'), path.join(publicOutDir, 'LICENSE'))
cpSync(
  path.join(repoRoot, 'packages/compiler/dist/compiler'),
  path.join(publicOutDir, 'compiler'),
  { recursive: true },
)

for (const packageInfo of packages) {
  const declarationRoot = path.join(repoRoot, 'packages', packageInfo.name, 'dist')
  if (!existsSync(declarationRoot)) throw new Error(`missing package output: ${packageInfo.name}`)
}
if (!existsSync(publicOutDir)) throw new Error('missing package output: irisout')

console.log('package bundles and declarations built')
