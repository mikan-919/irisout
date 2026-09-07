import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
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

for (const packageInfo of packages) {
  const declarationRoot = path.join(repoRoot, 'packages', packageInfo.name, 'dist')
  if (!existsSync(declarationRoot)) throw new Error(`missing package output: ${packageInfo.name}`)
}

console.log('package bundles and declarations built')
