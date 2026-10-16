// 最終生成物の同期比較3組と条件別調査を照合し、公式値と合わせて記録する。
import fs from 'node:fs'
import path from 'node:path'
const root = import.meta.dirname
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'))
const official = read('results.json')
const hashes = new Set(
  Object.entries(official.environment.irisoutAssets)
    .filter(([name]) => name.endsWith('.js'))
    .map(([, hash]) => hash),
)
const names = {
  create: '1,000行作成',
  replace: '1,000行置換',
  partial: '100行更新',
  select: '行選択',
  swap: '2行交換',
  remove: '1行削除',
  create10k: '10,000行作成',
  append: '1,000行追加',
  clear: '全行削除',
}
const median = (values) => {
  const a = [...values].sort((x, y) => x - y)
  return (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2
}
function compare(before, after, paired = true) {
  let seed = 42
  const pick = (values) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return Math.floor((seed / 4294967296) * values.length)
  }
  const differences = [],
    ratios = []
  for (let repeat = 0; repeat < 5000; repeat++) {
    const a = [],
      b = []
    for (let i = 0; i < before.length; i++) {
      const index = pick(before)
      a.push(before[index])
      b.push(after[paired ? index : pick(after)])
    }
    const first = median(a),
      second = median(b)
    differences.push(second - first)
    ratios.push(first > 0 ? second / first : Infinity)
  }
  differences.sort((a, b) => a - b)
  ratios.sort((a, b) => a - b)
  const a = median(before),
    b = median(after)
  return {
    before: a,
    after: b,
    difference: b - a,
    ratio: a > 0 ? b / a : null,
    difference95: [differences[125], differences[4875]],
    ratio95: ratios[4875] < Infinity ? [ratios[125], ratios[4875]] : null,
  }
}
function probe(file, scenarios = Object.keys(names)) {
  const value = read(file)
  if (!value.artifacts[1]?.length || value.artifacts[1].some((asset) => !hashes.has(asset.sha256)))
    throw Error('Different generated artifact: ' + file)
  if (Object.keys(value.samples).join(',') !== scenarios.join(','))
    throw Error('Incomplete scenarios: ' + file)
  for (const pair of Object.values(value.samples))
    if (
      pair.length !== 2 ||
      pair.some(
        (values) => values.length !== 100 || values.some((n) => !Number.isFinite(n) || n < 0),
      )
    )
      throw Error('Incomplete trials: ' + file)
  return value
}
const fmt = (value) => (value === null ? '—' : value.toFixed(4))
const interval = (values) => (values ? values.map(fmt).join('〜') : '—')
const row = (name, value) =>
  `| ${name} | ${fmt(value.before)} | ${fmt(value.after)} | ${fmt(value.difference)} | ${fmt(value.ratio)} | ${interval(value.difference95)} | ${interval(value.ratio95)} |`
const table = (rows) =>
  [
    '| 操作・条件 | 比較元（ms） | irisout（ms） | 絶対差（ms） | 比率 | 差の95%区間（ms） | 比率の95%区間 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n')
const analysis = {
  timestamp: new Date().toISOString(),
  assets: [...hashes],
  groups: [],
  stages: {},
  beforeAfter: {},
  clear: {},
  listeners: {},
  official: {},
  resources: {},
}
let output =
  '## 最終評価\n\n同じChromiumで同期比較を独立した3組、各操作100回実行した。各試行の実装順を交互にし、第2組は順序を反転した。同期時間は描画を含まない。差と比率の95%区間は組内の対応する試行を5,000回再抽出して求めた（初期値42）。9操作と3組の同時比較への補正は行っていない。0に接する区間を同等の証明として扱わない。\n'
for (const file of ['vanilla-comparison.json', 'work-vanilla-2.json', 'work-vanilla-3.json']) {
  const value = probe(file)
  if (value.cpuRate !== 1 || value.disableRowListenersInSecondPage)
    throw Error('Unexpected standard probe options')
  const comparisons = Object.fromEntries(
    Object.entries(value.samples).map(([name, pair]) => [name, compare(...pair)]),
  )
  analysis.groups.push({ file, comparisons })
  output +=
    `\n### 同期比較 第${analysis.groups.length}組\n\n比較元はVanilla。[全試行値](./${file})。\n\n` +
    table(Object.entries(comparisons).map(([name, value]) => row(names[name], value))) +
    '\n'
}
for (const [stage, reference] of [
  ['r1', 'work-r1.json'],
  ['ops', 'work-ops.json'],
  ['r4', 'work-r4-final.json'],
]) {
  const file = `work-${stage}-vanilla.json`
  const value = read(file)
  const expected = read(reference).artifacts[1].map((asset) => asset.sha256)
  if (value.artifacts[1].some((asset) => !expected.includes(asset.sha256)))
    throw Error('Different historical artifact: ' + file)
  if (Object.keys(value.samples).join(',') !== Object.keys(read(reference).samples).join(','))
    throw Error('Different historical scenarios: ' + file)
  for (const pair of Object.values(value.samples))
    if (
      pair.length !== 2 ||
      pair.some(
        (values) => values.length !== 100 || values.some((n) => !Number.isFinite(n) || n < 0),
      )
    )
      throw Error('Incomplete historical trials: ' + file)
  const comparisons = Object.fromEntries(
    Object.entries(value.samples).map(([name, pair]) => [name, compare(...pair)]),
  )
  analysis.stages[stage] = { file, comparisons }
  output +=
    `\n### 段階別のVanilla比較 ${stage}\n\n保存した各段階とSHA-256が一致する生成物を再構築し、Vanillaと各100試行で比較した。比較元はVanilla。[全試行値](./${file})。最終生成物の値とは混ぜない。\n\n` +
    table(Object.entries(comparisons).map(([name, value]) => row(names[name], value))) +
    '\n'
}
const before = probe('optimization.json')
analysis.beforeAfter = Object.fromEntries(
  Object.entries(before.samples).map(([name, pair]) => [name, compare(...pair)]),
)
output +=
  '\n### 最初の基準版との同期比較\n\n比較元は390f84aの生成物。[全試行値](./optimization.json)。\n\n' +
  table(Object.entries(analysis.beforeAfter).map(([name, value]) => row(names[name], value))) +
  '\n'
for (const rate of [1, 4])
  for (const count of [0, 1000, 10000]) {
    const file = `work-clear-${count}-${rate}x.json`,
      value = probe(file, ['clear'])
    if (value.cpuRate !== rate || value.clearRows !== count)
      throw Error('Unexpected clear conditions')
    analysis.clear[`${count}行・${rate}倍`] = { file, ...compare(...value.samples.clear) }
  }
output +=
  '\n### 全行削除の条件別比較\n\n比較元はVanilla。事前作成後に2回の描画機会を待ち、削除の同期処理だけを測った。0行は空一覧への操作であり、時計の分解能により比率を求められない場合がある。\n\n' +
  table(Object.entries(analysis.clear).map(([name, value]) => row(name, value))) +
  '\n'
const listeners = probe('work-listeners.json', ['create', 'create10k', 'clear'])
if (!listeners.disableRowListenersInSecondPage || listeners.urls[0] !== listeners.urls[1])
  throw Error('Unexpected listener conditions')
analysis.listeners = Object.fromEntries(
  Object.entries(listeners.samples).map(([name, pair]) => [name, compare(...pair)]),
)
output +=
  '\n### 行イベント登録の比較実験\n\n両ページに同じイベント登録の判定処理を挟み、第2ページだけ行内の登録を省いた。比較元は通常のirisout、第2列のirisoutは登録を省いた比較用ページである。選択・個別削除は機能しないため、製品の代替実装や公式値として扱わない。管理情報とハンドルの保存は両方に残る。全削除は1,000行を対象とする。[全試行値](./work-listeners.json)。\n\n' +
  table(Object.entries(analysis.listeners).map(([name, value]) => row(names[name], value))) +
  '\n'
const cpu = official.samples
  .filter((sample) => sample.type === 'cpu' && sample.framework.startsWith('vanillajs-'))
  .sort((a, b) => a.benchmark.localeCompare(b.benchmark))
if (cpu.length !== 9) throw Error('Incomplete official CPU scenarios')
for (const sample of cpu) {
  const iris = official.samples.find(
    (other) => other.framework.startsWith('irisout-') && other.benchmark === sample.benchmark,
  )
  if (!iris) throw Error('Missing official CPU sample')
  analysis.official[sample.benchmark] = compare(
    sample.values.total.values,
    iris.values.total.values,
    false,
  )
}
output +=
  '\n### 公式測定\n\n比較元はVanilla。CPU各10回、選択20回、メモリ各3回、転送量各1回。描画込みであり同期比較とは異なる。公式の実装間試行には対応がないため、95%区間は各実装を独立に再抽出した。5実装の値と処理・描画の内訳は[results.md](./results.md)、生値は[results.json](./results.json)にある。\n\n' +
  table(
    Object.entries(analysis.official).map(([name, value]) =>
      row(names[Object.keys(names)[Number(name.slice(0, 2)) - 1]], value),
    ),
  ) +
  '\n'
const baseline = read('baseline-results.json')
const resourceRows = []
for (const [id, label, unit] of [
  ['21_ready-memory', '起動後', 'MiB'],
  ['22_run-memory', '1,000行作成後', 'MiB'],
  ['25_run-clear-memory', '作成・削除5回後', 'MiB'],
  ['41_size-uncompressed', '圧縮前転送量', 'KiB'],
  ['42_size-compressed', 'Brotli転送量', 'KiB'],
]) {
  const metric = (data, framework) =>
    data.samples.find(
      (sample) => sample.framework.startsWith(framework + '-') && sample.benchmark === id,
    ).values.DEFAULT.median
  const value = {
    before: metric(baseline, 'irisout'),
    after: metric(official, 'irisout'),
    vanilla: metric(official, 'vanillajs'),
  }
  analysis.resources[id] = value
  resourceRows.push(
    `| ${label}（${unit}） | ${value.before.toFixed(3)} | ${value.after.toFixed(3)} | ${value.vanilla.toFixed(3)} |`,
  )
}
output +=
  '\n### メモリと転送量\n\nメモリは各3試行の中央値、転送量は各1回。メモリの小さな変化を速度改善や漏れの解消とは判定しない。\n\n| 指標 | 基準版irisout | 最終irisout | 最終Vanilla |\n| --- | ---: | ---: | ---: |\n' +
  resourceRows.join('\n') +
  '\n'
output +=
  '\n### 採否と残差\n\n全9操作でVanilla以下という目標は未達である。同期比較3組とも作成・10,000行作成・追加・交換はVanillaが短い。公式測定では作成2項目が長く、行選択は短く、他6項目は差の95%区間が0を含む。幾何平均が約1でも各操作の同等を示さない。\n\n- 除去した処理: 未使用の行状態の初期確保、初期テキストの形状検査、共通経路の参照、空classの再設定、構造操作の保持行照合、部分更新の未変更フィールド比較、条件を満たす交換の配列複製。\n- 現契約で維持する処理: 行への直接イベント登録、新規キーの重複検出、外部の子構造変更を復元する通常テキスト更新。イベント中の古い行参照を保持する経路では行オブジェクトを確保する。委譲には別の契約と設計判断が必要になる。\n- 寄与が未確定の費用: DOM除去と回収処理の内訳、行の管理情報それぞれの時間・メモリ寄与、イベント登録による全削除時間の差。\n\nmapの配列複製省略は速度差を確認できず不採用とした。交換・削除・作成の同期時間短縮を確認した変更は採用したが、Brotli転送量は4.0→4.7KiBへ増え、起動後と作成・削除後のメモリ中央値も増えた。時間・処理回数の改善を全指標の改善へ読み替えない。今回の解析で省けない処理が残ることは、別の実装による追加改善が不可能だという証明ではない。\n'
const source = path.join(root, 'work-results.md'),
  marker = '## 最終評価'
fs.writeFileSync(
  source,
  fs
    .readFileSync(source, 'utf8')
    .split(marker)[0]
    .replace(
      '描画込みの公式測定、メモリ、転送量の評価は次に記録する。',
      '描画込みの公式測定、メモリ、転送量の評価は以下に記録する。',
    ) + output,
)
fs.writeFileSync(path.join(root, 'work-analysis.json'), JSON.stringify(analysis, null, 2) + '\n')
console.log('Saved final work comparisons')
