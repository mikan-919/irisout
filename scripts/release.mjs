// 版の更新とタグの照合を行う。公開はGitHub Actionsが検証後に実行する。
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const [command, requested] = process.argv.slice(2)
const packagePath = 'packages/irisout/package.json'
const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
const version = command === 'prepare' ? requested : manifest.version
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '')) {
  throw new Error('release: version must be MAJOR.MINOR.PATCH')
}
const tag = `v${version}`
const changelogPath = 'packages/irisout/CHANGELOG.md'
const changelog = readFileSync(changelogPath, 'utf8')

if (command === 'prepare') {
  const previous = manifest.version
  const nextParts = version.split('.').map(Number)
  const previousParts = previous.split('.').map(Number)
  const differing = nextParts.findIndex((value, index) => value !== previousParts[index])
  if (differing === -1 || nextParts[differing] < previousParts[differing]) {
    throw new Error('release: new version must be greater than the source version')
  }
  // 変更履歴は作者が書く。過去の公開記録と比較測定の版は置き換えない。
  const files = [
    packagePath,
    'package.json',
    'README.md',
    'docs/getting-started.md',
    'apps/web/routes/docs/getting-started/page.tsx',
    'fixtures/consumer-app/README.md',
  ]
  const edits = files.map((file) => [
    file,
    readFileSync(file, 'utf8').replaceAll(previous, version),
  ])
  const lock = readFileSync('bun.lock', 'utf8')
  const updatedLock = lock.replace(
    /("packages\/irisout":\s*\{\s*"name": "irisout",\s*"version": ")[^"]+/,
    `$1${version}`,
  )
  if (updatedLock === lock)
    throw new Error('release: irisout workspace version missing in bun.lock')
  edits.push(['bun.lock', updatedLock])
  const date = new Date().toISOString().slice(0, 10)
  edits.push([
    changelogPath,
    changelog.replace(
      '# 変更履歴\n',
      `# 変更履歴\n\n## ${version} - ${date}\n\n- TODO: 変更内容を記入する。\n`,
    ),
  ])
  for (const [file, text] of edits) writeFileSync(file, text)
  console.log(`release: prepared ${tag}; edit ${changelogPath} before tagging`)
} else if (command === 'check') {
  if (requested && requested !== tag)
    throw new Error(`release: tag ${requested} does not match ${tag}`)
  const registryCommand = JSON.parse(readFileSync('package.json', 'utf8')).scripts['registry:smoke']
  if (!registryCommand.includes(`IRISOUT_PACKAGE_SPEC=${version} `)) {
    throw new Error('release: registry:smoke must use the release version')
  }
  const heading = `## ${version} - `
  const section = changelog.split('\n').findIndex((line) => line.startsWith(heading))
  if (section < 0) throw new Error(`release: changelog missing ${version}`)
  const notes = changelog
    .split('\n')
    .slice(section + 1)
    .join('\n')
    .split('\n## ')[0]
    .trim()
  if (!notes || /TODO/.test(notes)) throw new Error('release: changelog needs release notes')
  const notesPath = path.join(process.env.RUNNER_TEMP ?? tmpdir(), `irisout-${version}-notes.md`)
  writeFileSync(notesPath, `${notes}\n`)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${version}\ntag=${tag}\nnotes=${notesPath}\n`,
    )
  }
  console.log(`release: ${tag} matches the package and changelog`)
} else {
  throw new Error('release: use prepare <version> or check [tag]')
}
