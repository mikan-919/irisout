// jj の別名に検査を接続する。作業コピーの保存には介入しない。
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const [action, ...args] = process.argv.slice(2)

function run(command, argv) {
  const result = spawnSync(command, argv, { cwd: root, stdio: 'inherit' })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (action === 'install') {
  for (const [alias, command] of [
    ['ci', 'commit'],
    ['finish', 'commit'],
    ['push', 'push'],
  ]) {
    // 組み込みコマンドは上書きできないため、既存の ci と追加の別名を使う。
    run('jj', [
      'config',
      'set',
      '--repo',
      `aliases.${alias}`,
      JSON.stringify(['util', 'exec', '--', 'bun', script, command]),
    ])
  }
  console.log('設定済み: jj ci / jj finish / jj push')
} else if (action === 'commit' || action === 'push') {
  if (!args.includes('--help') && !args.includes('-h')) {
    // 自動修正で検査対象を変えず、失敗した場合は確定・送信を実行しない。
    run('bun', ['run', 'check'])
    run('bun', ['run', 'test'])
  }
  run('jj', action === 'commit' ? ['commit', ...args] : ['git', 'push', ...args])
} else {
  console.error('使い方: bun scripts/jj-hooks.mjs install|commit|push')
  process.exit(1)
}
