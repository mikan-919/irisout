// 公開前の版照合と版更新を、作業領域外のファイルで検証する。
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

const script = path.resolve(import.meta.dirname, '../../../scripts/release.mjs')

function withRelease(run: (root: string) => void): void {
  const root = mkdtempSync(path.join(tmpdir(), 'irisout-release-test-'))
  const files: Record<string, string> = {
    'packages/irisout/package.json': JSON.stringify({ name: 'irisout', version: '1.2.3' }),
    'packages/irisout/CHANGELOG.md':
      '# 変更履歴\n\n## 1.2.3 - 2026-10-05\n\n- JSX部品を追加する。\n',
    'package.json': JSON.stringify({
      scripts: { 'registry:smoke': 'IRISOUT_PACKAGE_SPEC=1.2.3 node scripts/pack-smoke.mjs' },
    }),
    'bun.lock': '{"packages/irisout": {"name": "irisout", "version": "1.2.3"}}',
    'README.md': 'irisout@1.2.3',
    'docs/getting-started.md': 'irisout@1.2.3',
    'apps/web/routes/docs/getting-started/page.tsx': 'irisout@1.2.3',
    'fixtures/consumer-app/README.md': 'irisout@1.2.3',
  }
  try {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      writeFileSync(path.join(root, file), text)
    }
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function command(root: string, ...args: string[]) {
  return spawnSync('bun', [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, RUNNER_TEMP: root, GITHUB_OUTPUT: path.join(root, 'outputs') },
  })
}

describe('リリース準備', () => {
  it('版を更新し、変更履歴の記入前は公開を拒否する', () => {
    withRelease((root) => {
      const prepared = command(root, 'prepare', '1.3.0')
      expect(prepared.status, prepared.stderr).toBe(0)
      expect(readFileSync(path.join(root, 'README.md'), 'utf8')).toBe('irisout@1.3.0')
      expect(readFileSync(path.join(root, 'bun.lock'), 'utf8')).toContain('"version": "1.3.0"')
      expect(command(root, 'check', 'v1.3.0').stderr).toContain('changelog needs release notes')
      const changelog = path.join(root, 'packages/irisout/CHANGELOG.md')
      writeFileSync(
        changelog,
        readFileSync(changelog, 'utf8').replace('TODO: 変更内容を記入する。', '文書を追加する。'),
      )
      const checked = command(root, 'check', 'v1.3.0')
      expect(checked.status, checked.stderr).toBe(0)
      expect(readFileSync(path.join(root, 'outputs'), 'utf8')).toContain('tag=v1.3.0')
      expect(readFileSync(path.join(root, 'irisout-1.3.0-notes.md'), 'utf8')).toBe(
        '- 文書を追加する。\n',
      )
      expect(readFileSync(changelog, 'utf8')).toContain('## 1.2.3 - 2026-10-05')
    })
  })

  it('タグ、導入検査の版、変更履歴が一致しない場合は拒否する', () => {
    withRelease((root) => {
      expect(command(root, 'check', 'v1.2.4').stderr).toContain('does not match')
      writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
          scripts: { 'registry:smoke': 'IRISOUT_PACKAGE_SPEC=1.2.2 node script.mjs' },
        }),
      )
      expect(command(root, 'check', 'v1.2.3').stderr).toContain('registry:smoke must use')
      writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
          scripts: { 'registry:smoke': 'IRISOUT_PACKAGE_SPEC=1.2.3 node script.mjs' },
        }),
      )
      writeFileSync(path.join(root, 'packages/irisout/CHANGELOG.md'), '# 変更履歴\n')
      expect(command(root, 'check', 'v1.2.3').stderr).toContain('changelog missing')
    })
  })

  it('同じ版、過去の版、タグとして使えない入力はファイルを変えず拒否する', () => {
    withRelease((root) => {
      for (const version of ['1.2.3', '1.2.2', '1.2.4; command']) {
        expect(command(root, 'prepare', version).status).not.toBe(0)
      }
      expect(
        JSON.parse(readFileSync(path.join(root, 'packages/irisout/package.json'), 'utf8')).version,
      ).toBe('1.2.3')
    })
  })
})
