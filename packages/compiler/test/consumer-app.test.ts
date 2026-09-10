import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { describe, expect, it } from 'vite-plus/test'

describe('consumer app integration', () => {
  it('builds an app from its own directory with the Vite plugin', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'irisout-consumer-build-'))
    const result = spawnSync(
      path.resolve('node_modules/.bin/vp'),
      ['-C', 'examples/consumer-app', 'build'],
      {
        env: {
          ...process.env,
          IRISOUT_OUT_DIR: outDir,
        },
      },
    )

    expect(result.status).toBe(0)
    const html = readFileSync(path.join(outDir, 'index.html'), 'utf8')
    expect(html).toContain('別アプリからの文章')
    expect(html).toContain('文字数: 9')
    expect(readdirSync(path.join(outDir, 'assets')).some((file) => file.endsWith('.js'))).toBe(true)
  })

  it('keeps authored handler positions in a production source map', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'irisout-consumer-source-map-'))
    const result = spawnSync(
      path.resolve('node_modules/.bin/vp'),
      ['-C', 'examples/consumer-app', 'build'],
      {
        env: {
          ...process.env,
          IRISOUT_OUT_DIR: outDir,
          IRISOUT_SOURCEMAP: 'true',
        },
      },
    )

    expect(result.status).toBe(0)
    const assetNames = readdirSync(path.join(outDir, 'assets'))
    const jsName = assetNames.find((file) => file.endsWith('.js'))
    const mapName = assetNames.find((file) => file.endsWith('.js.map'))
    expect(jsName).toBeDefined()
    expect(mapName).toBeDefined()
    const code = readFileSync(path.join(outDir, 'assets', jsName!), 'utf8')
    const needle = 'text = event.currentTarget.value'
    const offset = code.indexOf(needle)
    expect(offset).toBeGreaterThanOrEqual(0)
    const before = code.slice(0, offset)
    const original = originalPositionFor(
      new TraceMap(
        JSON.parse(
          readFileSync(path.join(outDir, 'assets', mapName!), 'utf8'),
        ) as ConstructorParameters<typeof TraceMap>[0],
      ),
      {
        line: before.split('\n').length,
        column: offset - before.lastIndexOf('\n') - 1,
      },
    )
    expect(original.source).toMatch(/src\/App\.jsx$/)
    expect(original.line).toBe(11)
  })
})
