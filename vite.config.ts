import { defineConfig } from 'vite-plus'

export default defineConfig({
  defaultPackage: './apps/demos',
  fmt: {
    ignorePatterns: [
      'openspec/**',
      'docs/adr/0001-first-milestone.md',
      'docs/adr/0002-event-handlers.md',
      'docs/adr/0003-browser-build.md',
      'docs/adr/0007-reject-build-time-dependency-tracker.md',
      'docs/adr/0008-zone-based-authoring-api.md',
      'docs/adr/0009-handler-statements-and-event-object.md',
      'docs/adr/0010-handwritten-js-escape-hatch.md',
      'docs/adr/0014-same-file-component-composition.md',
      '**/dist/**',
      '**/dist-size-test/**',
    ],
    singleQuote: true,
    semi: false,
  },
  lint: {
    ignorePatterns: ['**/dist/**', '**/dist-size-test/**', 'skills/**/assets/**'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        files: ['packages/compiler/test/**/*.ts'],
        rules: {
          'typescript/no-explicit-any': 'off',
        },
      },
      {
        files: [
          'packages/compiler/src/compiler.ts',
          'packages/compiler/src/compiler/source.ts',
          'packages/hono/src/index.ts',
        ],
        rules: {
          'typescript/no-implied-eval': 'off',
        },
      },
      {
        files: [
          'apps/demos/*.jsx',
          'apps/demos/**/*.jsx',
          'fixtures/consumer-app/**/*.jsx',
          'apps/web/**/*.jsx',
        ],
        rules: {
          'typescript/no-useless-default-assignment': 'off',
        },
      },
      {
        files: ['apps/demos/**/*.d.ts'],
        rules: {
          'typescript/no-useless-default-assignment': 'off',
        },
      },
    ],
  },
  test: {
    include: ['packages/compiler/test/**/*.test.ts'],
  },
  staged: {
    '*.{js,jsx,ts,tsx,json}': 'vp check --fix',
  },
})
