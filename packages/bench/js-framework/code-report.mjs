// 参照寿命の修正について、同じ生成物の全試行値と公式結果を照合して集計する。
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { strict as assert } from 'node:assert'
const root = import.meta.dirname
const read = (name) => JSON.parse(fs.readFileSync(`${root}/${name}`, 'utf8'))
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
  const ordered = [...values].sort((a, b) => a - b)
  return (ordered[(ordered.length - 1) >> 1] + ordered[ordered.length >> 1]) / 2
}
function compare(before, after, paired = true) {
  let seed = 42
  const pick = (length) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return Math.floor((seed / 4294967296) * length)
  }
  const differences = []
  for (let repeat = 0; repeat < 5000; repeat++) {
    const first = [],
      second = []
    for (let index = 0; index < before.length; index++) {
      const at = pick(before.length)
      first.push(before[at])
      second.push(after[paired ? at : pick(after.length)])
    }
    differences.push(median(second) - median(first))
  }
  differences.sort((a, b) => a - b)
  const a = median(before),
    b = median(after),
    ci = [differences[125], differences[4875]]
  return {
    before: a,
    after: b,
    difference: b - a,
    ratio: b / a,
    difference95: ci,
    verdict: ci[1] < 0 ? '短縮' : ci[0] > 0 ? '増加' : '差未確定',
  }
}
const official = read('results-code.json')
const oldOfficial = read('results.json')
const current = Object.entries(official.environment.irisoutAssets)
  .filter(([name]) => name.endsWith('.js'))
  .map(([, hash]) => hash)
const baseline = read('vanilla-code-work.json').measurements[1].assets.map((asset) => asset.sha256)
const hashes = (assets) => assets.map((asset) => asset.sha256)
const direct = hashes(read('code-direct-optimization.json').artifacts[1])
const groups = [
  ['optimization-code.json', '修正前の直接配線 → 修正後の委譲', baseline, current],
  ['code-direct-optimization.json', '修正前 → 修正後（ともに直接配線）', baseline, direct],
  ['code-direct-delegated.json', '修正後の直接配線 → 修正後の委譲', direct, current],
  ['vanilla-comparison-code.json', 'Vanilla → 修正後の委譲 第1組', null, current],
  ['code-vanilla-reverse.json', 'Vanilla → 修正後の委譲 第2組（順序を反転）', null, current],
]
const analysis = {
  assets: current,
  directAssets: direct,
  baselineAssets: baseline,
  groups: [],
  pilots: [],
  official: {},
  resources: {},
}
const fmt = (value) => value.toFixed(4)
const table = (values) =>
  [
    '| 操作 | 比較元（ms） | 比較先（ms） | 差（ms） | 比率 | 差の95%区間（ms） | 判定 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...Object.entries(values).map(
      ([name, v]) =>
        `| ${names[name]} | ${fmt(v.before)} | ${fmt(v.after)} | ${fmt(v.difference)} | ${fmt(v.ratio)} | ${v.difference95.map(fmt).join('〜')} | ${v.verdict} |`,
    ),
  ].join('\n')
let report = `# Vanillaコード調査後の修正と検証（2026-10-16）

実装はa9a10bd。修正前は6d67059で、製品側の生成物はe26ebc9と同じである。JSXは同じまま、イベント方式を構築設定で指定した。既定の直接配線を維持し、今回の公式比較では\`listEvents: 'delegated'\`を明示した。[設計](../../../docs/adr/0069-list-storage-and-explicit-click-delegation.md)と[公式5実装の結果](./results-code.md)を参照する。

作成・置換・部分更新・追加を短縮したが、全操作でVanilla以下の目標は未達である。作成後メモリは減った一方、転送量は増えた。委譲は選択の同期時間を増やすため、既定を切り替える根拠にはしない。

## 実装

- 作成用と更新用の参照を分け、削除リンクの保存と根の重複を省いた。所有する行のプリミティブなキーだけを表示する本文は、同じキーの寿命中の保存と比較を省く。
- 行の記録をFlatListHandleへ統合し、行ごとの包み1個を省いた。項目状態とbindingsの参照時の確保・同一性は保つ。互換用の包みをコンパイル済み経路から除いた。
- 通常照合の順序配列を保持し、map・交換・削除の行を添字で引く。変更の組ごとの配列確保を省き、追加・削除・交換後にも順序を更新する。元配列の複製と新しい行の確保は、古い参照と例外時の状態を保つため継続する。
- 全置換はMapを空にして新しい記録だけを再登録する。新旧合計の走査と旧キーごとの削除を省く。代わりに新規記録の登録が2回となる。キー検索と重複検出は残す。
- 通常要素の一覧は、すべて作成してから直接挿入する。親を文書から外さず、カスタム要素・is・入れ子・ライフサイクルは断片を保つ。
- 委譲指定時のルートの平坦な一覧では、引数なしclickだけを親で受ける。行ごとの登録と削除リンクの初期探索を省く。引数付きclickとblurは直接配線を保つ。非バブルのclick、途中の伝播停止、外部登録との順序は直接方式と異なる。

## 同期比較

各操作100試行、事前実行3回。レイアウト・描画を含めない。各試行の実装順を交互にし、Vanilla第2組は順序を反転した。差は比較先−比較元、比率は比較先÷比較元。対応する試行を5,000回再抽出し、中央値差の95%区間を求めた。初期値42の線形合同法（1664525、1013904223、32ビット）を使う。同時比較の補正はせず、0を含む区間を同等の証明にしない。
`
for (const [file, title, before, after] of groups) {
  const value = read(file)
  assert.deepEqual(Object.keys(value.samples), Object.keys(names))
  if (before) assert.deepEqual(hashes(value.artifacts[0]), before)
  assert.deepEqual(hashes(value.artifacts[1]), after)
  for (const pair of Object.values(value.samples))
    for (const samples of pair) {
      assert.equal(samples.length, 100)
      assert(samples.every((n) => Number.isFinite(n) && n >= 0))
    }
  const comparisons = Object.fromEntries(
    Object.entries(value.samples).map(([name, pair]) => [name, compare(...pair)]),
  )
  analysis.groups.push({ file, title, comparisons })
  report += `\n### ${title}\n\n[全試行値](./${file})。\n\n${table(comparisons)}\n`
}
report +=
  '\n## 挿入方式と保存領域の先行比較\n\n各操作30試行の先行比較である。最終版と異なる中間生成物を測っており、最終版と同じ値として合算しない。\n'
for (const [file, title] of [
  ['code-core-pilot.json', '保存領域・添字順・全置換'],
  ['code-insertion-pilot.json', '断片を使う方式 → 直接挿入'],
]) {
  const data = read(file),
    comparisons = Object.fromEntries(
      Object.entries(data.samples).map(([name, pair]) => [name, compare(...pair)]),
    )
  analysis.pilots.push({ file, assets: data.artifacts, comparisons })
  report += `\n### ${title}\n\n[全試行値](./${file})。\n\n${table(comparisons)}\n`
}
const find = (data, framework, id) =>
  data.samples.find(
    (sample) =>
      sample.framework.startsWith(
        framework === 'vanillajs' ? 'vanillajs-keyed' : framework + '-v',
      ) && sample.benchmark === id,
  )
const ids = [
  '01_run1k',
  '02_replace1k',
  '03_update10th1k_x16',
  '04_select1k',
  '05_swap1k',
  '06_remove-one-1k',
  '07_create10k',
  '08_create1k-after1k_x2',
  '09_clear1k_x8',
]
for (const [index, name] of Object.keys(names).entries()) {
  const before = find(official, 'vanillajs', ids[index]).values.total.values,
    after = find(official, 'irisout', ids[index]).values.total.values
  analysis.official[name] = compare(before, after, false)
}
report +=
  '\n## 公式比較でのVanillaとの差\n\n描画を含む全体時間。各10試行、選択20試行の独立した標本を再抽出した95%区間。同期比較と混ぜない。減速設定は[公式結果](./results-code.md)に記録する。\n\n' +
  table(analysis.official) +
  '\n'
report +=
  '\n## メモリと転送量\n\n| 指標 | 修正前irisout | 修正後irisout | 今回のVanilla |\n| --- | ---: | ---: | ---: |\n'
for (const [id, label] of [
  ['21_ready-memory', '起動後（MiB）'],
  ['22_run-memory', '1,000行作成後（MiB）'],
  ['25_run-clear-memory', '作成・削除5回後（MiB）'],
  ['41_size-uncompressed', '圧縮前（KiB）'],
  ['42_size-compressed', 'Brotli（KiB）'],
]) {
  const metric = {
    before: find(oldOfficial, 'irisout', id).values.DEFAULT.median,
    after: find(official, 'irisout', id).values.DEFAULT.median,
    vanilla: find(official, 'vanillajs', id).values.DEFAULT.median,
  }
  analysis.resources[id] = metric
  report += `| ${label} | ${fmt(metric.before)} | ${fmt(metric.after)} | ${fmt(metric.vanilla)} |\n`
}
const work = read('vanilla-work-code.json').measurements[1]
assert.deepEqual(hashes(work.assets), current)
for (const name of ['partial', 'swap'])
  assert.equal(work.results[name].counts['numericMap.get'] ?? 0, 0)
assert.equal(work.results.create.counts.addEventListener ?? 0, 0)
assert.equal(work.results.create.counts['fragment.append'] ?? 0, 0)
assert.equal(work.results.replace.counts['numericMap.delete'] ?? 0, 0)
for (const name of official.environment.keyedChecks) assert(name.includes(' is keyed for '))
assert.equal(official.samples.length, 75)
const sourceHash = createHash('sha256')
  .update(fs.readFileSync(root + '/irisout/main.jsx'))
  .digest('hex')
assert.equal(sourceHash, official.environment.sourceSha256)
report += `\n修正前は別の実行の値であり、資源量の推移を示す。メモリは各3試行のperformance.measureUserAgentSpecificMemory()で、DOMを含む文書関連領域を測り、JavaScriptだけの使用量ではない。直接配線の修正後は公式メモリを別測定していない。生成スクリプトのgzipは${(read('optimization-code.json').artifacts[0][0].gzipBytes / 1024).toFixed(2)}→${(read('optimization-code.json').artifacts[1][0].gzipBytes / 1024).toFixed(2)}KiB。\n
## 処理回数と残る費用

[全9操作の計装](./vanilla-work-code.json)を時間測定とは別に実行した。1,000行作成中のイベント登録は2,000→0件、作成1行のDOM参照は固定費を除き8→5回となった。断片への追加1,000回を省き、最終親への挿入1,000回を行う。100行更新と交換の行のMap検索は0回となった。委譲のクリック自体には、削除済みの記録を除くためMap検索1回がある。

全置換はMap検索1,000回・登録2,000回・一括消去1回で、旧キー削除1,000回と新旧2,000記録の走査を省いた。キーがすべて新しいという静的証明は追加していない。順序配列の保持と削除時の詰め直し、配列複製、新しい行、変更記録、値比較、境界と親の検査は残る。

同期比較では選択・交換、組によっては削除・全削除にVanillaとの差が残る。委譲は選択を増加させ、削除でも中央値が増えた。既定の直接配線と選択可能な方式の結果を分けて評価する。公式の全体時間には描画の差も残り、作成時のJavaScript短縮だけで全体がVanilla以下になるとは言えない。

## 検証

全516試験、型検査、公開パッケージの構築と梱包物の導入、実例構築、文書5試験、MotionとPlaygroundのブラウザー試験、3画面幅の表示検査と8操作、公式5実装のキー付き判定を通過した。[ブラウザー検査の保存値](./code-verification.json)を参照する。生成物のSHA-256は同期比較・計装・公式測定で一致し、全75組の公式生値を保存した。[解析値](./code-analysis.json)にも95%区間を保存する。
`
fs.writeFileSync(root + '/code-analysis.json', JSON.stringify(analysis, null, 2) + '\n')
fs.writeFileSync(root + '/code-work-results.md', report)
const officialReport = root + '/results-code.md'
const officialText = fs.readFileSync(officialReport, 'utf8')
const modeNote =
  "この測定は`listEvents: 'delegated'`を明示した版である。既定の直接配線との比較、変更内容、増加した時間は[修正の検証](./code-work-results.md)を参照する。"
if (!officialText.includes(modeNote))
  fs.writeFileSync(officialReport, officialText.replace('\n\n', '\n\n' + modeNote + '\n\n'))
console.log(
  JSON.stringify(
    {
      assets: current,
      beforeAfter: analysis.groups[0].comparisons,
      official: analysis.official,
      resources: analysis.resources,
    },
    null,
    2,
  ),
)
