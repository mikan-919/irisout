// 公式の試行値を保存し、中央値と同一環境での時間比を表にする。
import fs from 'node:fs'
import path from 'node:path'
import { frameworks, root } from './config.mjs'

const directory = path.join(root, 'results')
const environment = JSON.parse(fs.readFileSync(path.join(directory, 'environment.json'), 'utf8'))
const samples = fs
  .readdirSync(directory)
  .filter((file) => file.endsWith('.json') && file !== 'environment.json')
  .map((file) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')))
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
  '21_ready-memory',
  '22_run-memory',
  '25_run-clear-memory',
  '41_size-uncompressed',
  '42_size-compressed',
  '43_first-paint',
]
const labels = [
  '1,000行作成',
  '1,000行置換',
  '10行ごとに更新（4倍減速）',
  '行選択（4倍減速）',
  '2行交換（4倍減速）',
  '1行削除（2倍減速）',
  '10,000行作成',
  '1,000行へ1,000行追加',
  '全行削除（4倍減速）',
  '起動後',
  '1,000行作成後',
  '作成・削除を5回実行後',
  '圧縮前',
  'Brotli圧縮後',
  '初回描画（ms、各1回）',
]
function find(name, id) {
  const matches = samples.filter(
    (result) =>
      result.benchmark === id &&
      (name === 'vanillajs'
        ? result.framework === 'vanillajs-keyed'
        : result.framework.startsWith(name + '-v')),
  )
  if (matches.length !== 1)
    throw new Error(`Expected one result for ${name}/${id}, got ${matches.length}`)
  const result = matches[0]
  const values = result.type === 'cpu' ? result.values.total : result.values.DEFAULT
  if (!values.values.length || values.values.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error(`Invalid samples for ${name}/${id}`)
  const expected =
    result.type === 'cpu'
      ? environment.count + (id === '04_select1k' ? 10 : 0)
      : result.type === 'memory'
        ? environment.memoryCount
        : 1
  if (values.values.length !== expected)
    throw new Error(`Incomplete samples for ${name}/${id}: ${values.values.length}/${expected}`)
  return values.median
}
const rows = ids.map(
  (id, index) =>
    `| ${labels[index]} | ${frameworks.map((name) => find(name, id).toFixed(2)).join(' | ')} |`,
)
const ratios = frameworks.map((name) =>
  Math.exp(
    ids.slice(0, 9).reduce((sum, id) => sum + Math.log(find(name, id) / find('vanillajs', id)), 0) /
      9,
  ),
)
const table = (from, to) =>
  [
    '| 操作 | irisout | React Hooks | Vue | Solid | JavaScript |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...rows.slice(from, to),
  ].join('\n')
const probeFile = path.join(root, 'optimization.json')
const probe = fs.existsSync(probeFile) ? JSON.parse(fs.readFileSync(probeFile, 'utf8')) : null
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const probeTable = probe
  ? Object.values(probe.samples)
      .map((runs, index) => {
        const [before, after] = runs.map(median)
        return `| ${labels[index].replace(/（.*）/, '')} | ${before.toFixed(4)} | ${after.toFixed(4)} | ${(before / after).toFixed(2)} |`
      })
      .join('\n')
  : ''
const report = `# js-framework-benchmark 比較結果

同じ環境で上流の本番実装と公式測定器を実行した結果。公開ランキングとは測定環境が異なる。

## 条件

- 測定日時: ${environment.measurementStartedAt ? `${environment.measurementStartedAt} ～ ` : ''}${environment.timestamp}
- 上流: [krausest/js-framework-benchmark](https://github.com/krausest/js-framework-benchmark/tree/${environment.upstreamCommit})
- irisout: ${environment.irisoutCommit} の作業木。実装と環境情報はこのディレクトリに保存。
- ブラウザー: ${environment.browser}、画面を表示しない方式、1280×800。
- CPU: ${environment.cpu}、論理${environment.logicalCpus}個。${environment.platform}。
- Node ${environment.node}、Bun ${environment.bun}。
- すべてキー付き一覧。上流のisKeyed検査でDOM構造と作成・削除・交換時の要素再利用を確認。
- CPUは各${environment.count}回、選択は上流の追加試行により${environment.count + 10}回。メモリは各${environment.memoryCount}回、転送量と初回描画は各1回。値は中央値。
- 上流の事前実行回数とCPU減速設定を維持。CPU値はクリックから描画までのtotal。03のx16、08のx2、09のx8は上流の識別名で、表に追加の乗除算をしていない。

## 操作時間（ms、小さいほど短い）

${table(0, 9)}

| 指標 | irisout | React Hooks | Vue | Solid | JavaScript |
| --- | ---: | ---: | ---: | ---: | ---: |
| JavaScriptを1とした時間比の幾何平均 | ${ratios.map((value) => value.toFixed(2)).join(' | ')} |

9操作の中央値をJavaScriptで割り、等しい重みで幾何平均（比率を掛け合わせた平均）を求めた。上流の重み付き総合指標とは異なる。

${
  probe
    ? `## 修正前後の同期処理時間（ms）

同じJSXを修正前（30d856b7c47c21527236ee62f061c802a1d22edd）と修正後で構築し、同じブラウザーで順序を交互にして測定した。3回の事前実行後に15試行。選択は200回、交換は20回の操作から1回当たりを求める。同期したイベント処理とDOM書き込みの時間であり、レイアウト・描画を含まない。上の公式測定とは別の指標。

| 操作 | 修正前 | 修正後 | 修正前÷修正後 |
| --- | ---: | ---: | ---: |
${probeTable}

全試行値は[optimization.json](./optimization.json)を参照。
`
    : ''
}

## メモリ（MiB）

${table(9, 12)}

上流のperformance.measureUserAgentSpecificMemory()を使用し、ガベージコレクション（不要になった領域の回収）後の文書関連メモリを測る。JavaScriptの使用領域だけ、またはブラウザー全体の常駐量を示す値ではない。

## 転送量（KiB）と初回描画

${table(12, 15)}

上流の配信サーバーが集計したHTMLとスクリプト等の合計。共通の/cssとHTTPヘッダーは含まない。irisoutも初期HTMLと生成スクリプトを含む。初回描画は1回の参考値で、Lighthouseの起動時間評価は実施していない。

## 解釈の範囲

単一環境での測定であり、一般のアプリ全体の性能順位を示さない。React・Vue・Solidは上流の実装と構築設定を維持した。irisoutは宣言した状態と一覧から生成し、手書きのDOM操作や測定専用の実行時最適化を加えていない。生の全試行値、script/paint内訳、版情報は[results.json](./results.json)を参照。再実行は[README.md](./README.md)を参照。
`
fs.writeFileSync(
  path.join(root, 'results.json'),
  JSON.stringify({ environment, samples }, null, 2) + '\n',
)
fs.writeFileSync(path.join(root, 'results.md'), report)
console.log(report)
