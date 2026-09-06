import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
})
