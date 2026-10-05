// 検査失敗時に jj の確定・送信を実行しないことを子プロセスで確認する。
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vite-plus/test'

it('検査の成功時だけ jj を実行し、引数を渡す', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'irisout-jj-test-'))
  const script = path.resolve(import.meta.dirname, '../../../scripts/jj-hooks.mjs')
  const bun = spawnSync('bun', ['-e', 'console.log(process.execPath)'], {
    encoding: 'utf8',
  }).stdout.trim()
  const log = path.join(root, 'calls')
  try {
    for (const command of ['bun', 'jj']) {
      writeFileSync(
        path.join(root, command),
        `#!/bin/sh\nprintf '%s\\n' "${command}:$*" >> "$CALLS"\nif [ "${command}:$*" = "$FAIL_CALL" ]; then exit 7; fi\n`,
        { mode: 0o755 },
      )
    }
    const run = (action: string, args: string[], fail = '') => {
      writeFileSync(log, '')
      const result = spawnSync(bun, [script, action, ...args], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${root}:${process.env.PATH}`, CALLS: log, FAIL_CALL: fail },
      })
      return { status: result.status, calls: readFileSync(log, 'utf8') }
    }
    expect(run('commit', ['-m', 'Add feature'])).toEqual({
      status: 0,
      calls: 'bun:run check\nbun:run test\njj:commit -m Add feature\n',
    })
    expect(run('push', ['--bookmark', 'main'])).toEqual({
      status: 0,
      calls: 'bun:run check\nbun:run test\njj:git push --bookmark main\n',
    })
    for (const action of ['commit', 'push']) {
      expect(run(action, [], 'bun:run check')).toEqual({ status: 7, calls: 'bun:run check\n' })
      expect(run(action, [], 'bun:run test')).toEqual({
        status: 7,
        calls: 'bun:run check\nbun:run test\n',
      })
    }
    expect(run('push', ['--help'])).toEqual({ status: 0, calls: 'jj:git push --help\n' })
    expect(run('install', []).calls).toContain('jj:config set --repo aliases.ci')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
