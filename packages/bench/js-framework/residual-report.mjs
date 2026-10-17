// 残差削減の各段階を混ぜず、生成物と全試行値を検証して差を再集計する。
import fs from 'node:fs'
import { strict as assert } from 'node:assert'
const root = import.meta.dirname
const read = (name) => JSON.parse(fs.readFileSync(`${root}/${name}`, 'utf8'))
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2
}
function compare(before, after, paired = true) {
  let seed = 42
  const pick = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return Math.floor((seed / 4294967296) * n)
  }
  const differences = []
  for (let run = 0; run < 5000; run++) {
    const a = [],
      b = []
    for (let i = 0; i < before.length; i++) {
      const index = pick(before.length)
      a.push(before[index])
      b.push(after[paired ? index : pick(after.length)])
    }
    differences.push(median(b) - median(a))
  }
  differences.sort((a, b) => a - b)
  const a = median(before),
    b = median(after)
  const interval = [differences[125], differences[4875]]
  return {
    before: a,
    after: b,
    difference: b - a,
    ratio: b / a,
    interval,
    verdict: interval[1] < -1e-7 ? '短縮' : interval[0] > 1e-7 ? '増加' : '差未確定',
  }
}
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
const official = read('results-residual-final.json')
const scriptHashes = (value) =>
  Object.entries(value.environment.irisoutAssets)
    .filter(([name]) => name.endsWith('.js'))
    .map(([, hash]) => hash)
const hashes = scriptHashes(official)
const beforeHashes = scriptHashes(read('results-code.json'))
const analysis = { hashes, beforeHashes, synchronous: {}, official: {}, pilots: {}, resources: {} }
const fmt = (n) => n.toFixed(4)
const table = (values) =>
  [
    '| 操作 | 比較元 ms | 比較先 ms | 比率 | 差の95%区間 ms | 判定 |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    ...Object.entries(values).map(
      ([name, v]) =>
        `| ${names[name]} | ${fmt(v.before)} | ${fmt(v.after)} | ${fmt(v.ratio)} | ${v.interval.map(fmt).join('〜')} | ${v.verdict} |`,
    ),
  ].join('\n')
function probe(file, expectedCount, expectedHashes) {
  const data = read(file)
  if (expectedHashes)
    assert.deepEqual(
      data.artifacts[1].map((a) => a.sha256),
      expectedHashes,
    )
  for (const pair of Object.values(data.samples))
    for (const values of pair) {
      assert.equal(values.length, expectedCount)
      assert(values.every((value) => Number.isFinite(value) && value >= 0))
    }
  return {
    hashes: data.artifacts.map((assets) => assets.map((a) => a.sha256)),
    comparisons: Object.fromEntries(
      Object.entries(data.samples).map(([name, pair]) => [name, compare(...pair)]),
    ),
  }
}
let report = `# Vanillaとの差の削減と検証（2026-10-17）

実装は2832a8c。修正前は0523769。JSXのSHA-256は変えていない。選択の再検索、委譲の経路配列・不要な祖先探索、削除の二重コールバック、交換のDOM探索と汎用記録、全削除の境界再挿入を除いた。DOMを外部へ渡さない表だけ親を専有し、空の節を外して追加する。範囲外・複数一覧・再入・例外後・SSRは従来照合を保つ。[ADR-0070](../../../docs/adr/0070-exclusive-table-list-containers.md)を参照。

今回の公式再測定はirisoutとVanillaの2実装。ほかの3実装の直近の比較は[前回の5実装](./results-code.md)に残す。最終版の測定として混ぜない。

## 同期処理

各9操作100試行、事前3回、実装順を交互にする。選択は200クリック、交換は20クリックの平均。描画を含まない。比率は比較先÷比較元。対応する試行を5,000回再抽出した中央値差の95%区間。初期値42、32ビット線形合同法を使用する。時刻差の浮動小数点誤差を増減と判定しないため、区間端が0から1e-7ms以内の場合は差未確定とする。複数比較の補正はせず、0を含む区間は同等の証明にしない。
`
for (const [file, title] of [
  ['optimization-residual-final.json', '修正前 → 最終版'],
  ['vanilla-comparison-residual-final.json', 'Vanilla → 最終版 第1組'],
  ['residual-final-vanilla-reverse.json', 'Vanilla → 最終版 第2組（順序反転）'],
]) {
  const data = read(file)
  assert.deepEqual(Object.keys(data.samples), Object.keys(names))
  const result = probe(file, 100, hashes)
  if (file.startsWith('optimization')) assert.deepEqual(result.hashes[0], beforeHashes)
  analysis.synchronous[file] = result
  report += `\n### ${title}\n\n[全試行値](./${file})。\n\n${table(result.comparisons)}\n`
}
const work = read('residual-final-work.json')
assert.deepEqual(
  work.measurements[1].assets.map((a) => a.sha256),
  hashes,
)
const counts = work.measurements[1].results
assert.deepEqual(counts.swap.counts, { insertBefore: 2 })
assert.deepEqual(counts.clear.counts, { 'map.clear': 1, textContent: 1 })
assert.equal(counts.remove.counts['numericMap.get'] ?? 0, 0)
report += `
## 処理回数と残る差

[全9操作の計装](./residual-final-work.json)は時間測定と分けた。交換のDOM操作は両方insertBefore 2回、irisoutの親・隣接参照は0回。全削除のDOM操作は両方textContent 1回となった。irisoutには管理Mapの消去が1回残る。選択は初回の前回キー検索1回、親参照2回、className設定1回。連続選択では保持した行を使い、行のMap検索を行わない。削除には行のMap検索と二重コールバックがなく、DOM削除1回・添字順のsplice 1回で保持行を再評価しない。

作成・置換・追加にはキーの重複検出と行の記録、部分更新には配列複製・新しい行・変更記録・値比較100回が残る。置換はMap登録2,000回。交換には通知・生存状態・配列と行の対応の検査が残り、Vanillaの無条件の2挿入とは同じJavaScriptではない。DOM操作が同じでも所要時間の一致は証明しない。これらの追加契約と任意のキー・古い行参照・失敗後の回復を保ちつつ除くには、さらに証明が必要である。不可能とは確認していない。

## 公式測定と順序の検査

描画を含む。CPU各10回、選択20回。減速は03・04・05・09が4倍、06が2倍。同じ生成物で上流の/lsを反転して実際の順序も検査した。CLIの--frameworkの列挙順は実行順を変えないため、[返却順だけを変えるサーバー](./reverse-server.mjs)を使用した。初回のメモリは3回、反転実行は1回。CPU同士を独立に5,000回再抽出し、2組を合算しない。
`
for (const [file, title] of [
  ['results-residual-final.json', 'Vanilla → irisoutの順'],
  ['results-residual-final-reverse.json', 'irisout → Vanillaの順'],
]) {
  const data = read(file)
  assert.deepEqual(scriptHashes(data), hashes)
  if (file.includes('reverse')) {
    assert.equal(data.environment.reverseFrameworkOrder, true)
    assert.match(data.environment.serverFrameworkOrder[0], /^irisout-v/)
    assert.equal(data.environment.serverFrameworkOrder[1], 'vanillajs-keyed')
  }
  assert.equal(data.samples.length, 30)
  for (const result of data.samples) {
    const expected =
      result.type === 'cpu'
        ? data.environment.count + (result.benchmark === ids[3] ? 10 : 0)
        : result.type === 'memory'
          ? data.environment.memoryCount
          : 1
    for (const stats of Object.values(result.values)) {
      assert.equal(stats.values.length, expected)
      assert(stats.values.every((n) => Number.isFinite(n) && n >= 0))
    }
  }
  const find = (id, name, part = 'total') =>
    data.samples.find(
      (r) =>
        r.benchmark === id &&
        (name === 'vanillajs'
          ? r.framework === 'vanillajs-keyed'
          : r.framework.startsWith('irisout-v')),
    ).values[part].values
  const sections = Object.fromEntries(
    ['total', 'script', 'paint'].map((part) => [
      part,
      Object.fromEntries(
        Object.keys(names).map((name, index) => [
          name,
          compare(find(ids[index], 'vanillajs', part), find(ids[index], 'irisout', part), false),
        ]),
      ),
    ]),
  )
  analysis.official[file] = sections
  report += `\n### ${title}\n\n[公式全試行値](./${file})。区間は全体時間の差。\n\n${table(sections.total)}\n`
  if (file === 'results-residual-final.json')
    for (const id of [
      '21_ready-memory',
      '22_run-memory',
      '25_run-clear-memory',
      '41_size-uncompressed',
      '42_size-compressed',
    ])
      analysis.resources[id] = Object.fromEntries(
        ['irisout', 'vanillajs'].map((name) => [name, median(find(id, name, 'DEFAULT'))]),
      )
}
for (const file of [
  'residual-rejected-swap-pilot.json',
  'residual-direct-swap-pilot.json',
  'residual-native-events-pilot.json',
  'residual-native-events-vanilla-pilot.json',
])
  analysis.pilots[file] = probe(file, 200)
report += `
## メモリと転送量

| 指標 | 単位 | irisout | Vanilla |
| --- | --- | ---: | ---: |
${[
  ['21_ready-memory', '起動後', 'MiB'],
  ['22_run-memory', '1,000行作成後', 'MiB'],
  ['25_run-clear-memory', '作成・削除5回後', 'MiB'],
  ['41_size-uncompressed', '圧縮前', 'KiB'],
  ['42_size-compressed', 'Brotli圧縮後', 'KiB'],
]
  .map(
    ([id, label, unit]) =>
      `| ${label} | ${unit} | ${fmt(analysis.resources[id].irisout)} | ${fmt(analysis.resources[id].vanillajs)} |`,
  )
  .join('\n')}

初回の公式実行から、メモリ3試行・転送量1試行の中央値。メモリは文書関連領域でありJavaScriptだけの使用量ではない。転送量はHTMLとスクリプト等を含み、共通CSSとHTTPヘッダーを除く。最終版にも資源量の差がある。

## 段階と検査

[専有親の段階](./results-residual.md)はc1e7e01、[交換の専用出力の段階](./results-residual-specialized.md)は7833205。最終版の値へ合算しない。[交換記録だけを変えた試作](./residual-rejected-swap-pilot.json)は200試行で短縮を確認できず採用しなかった。[交換の専用出力](./residual-direct-swap-pilot.json)と[経路の専用出力](./residual-native-events-pilot.json)は各200試行で段階間の短縮を確認した。後者の[Vanillaとの比較](./residual-native-events-vanilla-pilot.json)も別に保存した。最終比較は上の全9操作を使う。

全532試験・型検査、梱包物の導入、実例、文書5試験、サーバー23試験、保存2試験、Motion・Playground、公式2実装のキー付き判定、3画面幅の表示と8操作を通過した。[検証記録](./residual-verification.json)、[表示](./residual-final-integrity.json)、[操作](./residual-final-flow.json)を参照。

同期と公式の結果は異なる指標であり、同期比較だけで描画込みの達成を判定しない。最終版でも全操作がVanilla以下という目標は達成していない。表示・データ・生成物を揃えて確認した処理の削減と、なお残る時間差を区別する。
`
fs.writeFileSync(`${root}/residual-analysis.json`, JSON.stringify(analysis, null, 2) + '\n')
fs.writeFileSync(`${root}/residual-results.md`, report)
console.log(JSON.stringify(analysis.synchronous, null, 2))
