// 公式の試行値を保存し、中央値と同一環境での時間比を表にする。
import fs from 'node:fs'
import path from 'node:path'
import { root } from './config.mjs'

const tag = process.env.JSFB_RESULT_TAG ?? ''
if (tag && !/^[a-z0-9-]+$/.test(tag)) throw new Error('Invalid JSFB_RESULT_TAG')
const suffix = tag ? `-${tag}` : ''
const directory = path.join(root, `results${suffix}`)
const environment = JSON.parse(fs.readFileSync(path.join(directory, 'environment.json'), 'utf8'))
const frameworks = environment.frameworks
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
function resultFor(name, id) {
  const matches = samples.filter(
    (result) =>
      result.benchmark === id &&
      (name === 'vanillajs'
        ? result.framework === 'vanillajs-keyed'
        : result.framework.startsWith(name + '-v')),
  )
  if (matches.length !== 1)
    throw new Error(`Expected one result for ${name}/${id}, got ${matches.length}`)
  return matches[0]
}
function find(name, id) {
  const result = resultFor(name, id)
  const values = result.type === 'cpu' ? result.values.total : result.values.DEFAULT
  const expected =
    result.type === 'cpu'
      ? environment.count + (id === '04_select1k' ? 10 : 0)
      : result.type === 'memory'
        ? environment.memoryCount
        : 1
  for (const measured of result.type === 'cpu' ? Object.values(result.values) : [values]) {
    if (
      !measured.values.length ||
      measured.values.some((value) => !Number.isFinite(value) || value < 0)
    )
      throw new Error(`Invalid samples for ${name}/${id}`)
    if (measured.values.length !== expected)
      throw new Error(`Incomplete samples for ${name}/${id}: ${measured.values.length}/${expected}`)
  }
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
    `| 操作 | ${frameworks.map((name) => ({ 'react-hooks': 'React Hooks', vue: 'Vue', solid: 'Solid', vanillajs: 'Vanilla' })[name] ?? name).join(' | ')} |`,
    `| --- | ${frameworks.map(() => '---:').join(' | ')} |`,
    ...rows.slice(from, to),
  ].join('\n')
const cpuDetails = ids
  .slice(0, 9)
  .map((id, index) => {
    const vanilla = resultFor('vanillajs', id).values
    const irisout = resultFor('irisout', id).values
    return `| ${labels[index]} | ${vanilla.script.median.toFixed(2)} | ${irisout.script.median.toFixed(2)} | ${(irisout.script.median / vanilla.script.median).toFixed(2)} | ${vanilla.paint.median.toFixed(2)} | ${irisout.paint.median.toFixed(2)} |`
  })
  .join('\n')
// 別の生成物を測った同期値を、今回の公式値と同じ版として表示しない。
const measuredScripts = new Set(
  Object.entries(environment.irisoutAssets ?? {})
    .filter(([file]) => file.endsWith('.js'))
    .map(([, hash]) => hash),
)
function readCurrentProbe(file) {
  const source = path.join(root, file)
  if (!fs.existsSync(source)) return null
  const value = JSON.parse(fs.readFileSync(source, 'utf8'))
  const scripts = value.artifacts?.[1] ?? []
  if (!scripts.length || scripts.some((script) => !measuredScripts.has(script.sha256))) {
    console.log(`Skipping ${file}: measured scripts do not match this run`)
    return null
  }
  const expectedScenarios = [
    'create',
    'replace',
    'partial',
    'select',
    'swap',
    'remove',
    'create10k',
    'append',
    'clear',
  ]
  if (Object.keys(value.samples).join(',') !== expectedScenarios.join(','))
    throw new Error(`Incomplete probe scenarios: ${file}`)
  for (const [scenario, runs] of Object.entries(value.samples)) {
    if (
      runs.length !== 2 ||
      !runs[0].length ||
      runs[0].length !== runs[1].length ||
      runs.some((values) => values.some((sample) => !Number.isFinite(sample) || sample < 0))
    )
      throw new Error(`Invalid paired probe samples: ${file}/${scenario}`)
  }
  return value
}
const probe = readCurrentProbe(`optimization${suffix}.json`)
const vanillaProbe = readCurrentProbe(`vanilla-comparison${suffix}.json`)
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2
}
function pairedDifferenceInterval(before, after) {
  if (before.length !== after.length) throw new Error('Paired probe samples have different lengths')
  let seed = 42
  const differences = []
  for (let repeat = 0; repeat < 5000; repeat++) {
    const first = [],
      second = []
    for (let index = 0; index < before.length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const selected = Math.floor((seed / 4294967296) * before.length)
      first.push(before[selected])
      second.push(after[selected])
    }
    differences.push(median(second) - median(first))
  }
  differences.sort((a, b) => a - b)
  return [differences[125], differences[4875]]
}
const gzipSizes = probe?.artifacts?.map((assets) =>
  assets.reduce((sum, asset) => sum + asset.gzipBytes, 0),
)
const sizeNote = gzipSizes?.every(Number.isFinite)
  ? `直接読み込む生成スクリプトのgzip合計は${(gzipSizes[0] / 1024).toFixed(2)}→${(gzipSizes[1] / 1024).toFixed(2)}KiB。HTMLと共通CSSはこの値に含まない。`
  : ''
const probeTable = probe
  ? Object.values(probe.samples)
      .map((runs, index) => {
        const [before, after] = runs.map(median)
        return `| ${labels[index].replace(/（.*）/, '')} | ${before.toFixed(4)} | ${after.toFixed(4)} | ${(before / after).toFixed(2)} |`
      })
      .join('\n')
  : ''
const vanillaTable = vanillaProbe
  ? Object.values(vanillaProbe.samples)
      .map((runs, index) => {
        const [vanilla, irisout] = runs.map(median)
        const [low, high] = pairedDifferenceInterval(...runs)
        const verdict = low > 0 ? 'irisoutが遅い' : high < 0 ? 'irisoutが速い' : '差未確定'
        return `| ${labels[index].replace(/（.*）/, '')} | ${vanilla.toFixed(4)} | ${irisout.toFixed(4)} | ${(irisout / vanilla).toFixed(2)} | ${low.toFixed(4)}〜${high.toFixed(4)} | ${verdict} |`
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

| 指標 | ${frameworks.map((name) => ({ 'react-hooks': 'React Hooks', vue: 'Vue', solid: 'Solid', vanillajs: 'Vanilla' })[name] ?? name).join(' | ')} |
| --- | ${frameworks.map(() => '---:').join(' | ')} |
| Vanillaを1とした時間比の幾何平均 | ${ratios.map((value) => value.toFixed(2)).join(' | ')} |

9操作の中央値をVanillaで割り、等しい重みで幾何平均（比率を掛け合わせた平均）を求めた。上流の重み付き総合指標とは異なる。

## Vanillaとの差の内訳（公式測定、ms）

| 操作 | JavaScript処理：Vanilla | JavaScript処理：irisout | 処理時間比 | 描画：Vanilla | 描画：irisout |
| --- | ---: | ---: | ---: | ---: | ---: |
${cpuDetails}

処理時間比はirisout÷Vanilla。減速倍率は上の操作名に従う。scriptとpaintは上流測定器の区分で、描画にはレイアウトを含む。各中央値は別々に求めるため、足して全体と一致するとは限らない。全体の差が小さくても、JavaScript処理に差が残る場合を区別する。

${
  probe
    ? `## 修正前後の同期処理時間（ms）

同じJSXを修正前（${probe.baselineCommit ?? '第1URL'}）と修正後で構築し、同じブラウザーで順序を交互にして測定した。3回の事前実行後に${Object.values(probe.samples)[0][0].length}試行。選択は200回、交換は20回の操作から1回当たりを求める。同期したイベント処理とDOM書き込みの時間であり、レイアウト・描画を含まない。上の公式測定とは別の指標。

| 操作 | 修正前 | 修正後 | 修正前÷修正後 |
| --- | ---: | ---: | ---: |
${probeTable}

${sizeNote}

全試行値は[optimization.json](./optimization.json)を参照。
`
    : ''
}

${
  vanillaProbe
    ? `## 手書きJavaScriptとの同期処理比較（ms）

上流のvanillajs実装と今回のirisoutを、同じ乱数の初期値と順序を交互にする${Object.values(vanillaProbe.samples)[0][0].length}試行で比較した。両ページのconsole.logを抑止し、手書き実装に残る開発用ログの転送費用を除く。レイアウト・描画は含まない。比率はirisoutの時間をVanillaで割った値で、1未満ならirisoutが短い。

| 操作 | Vanilla | irisout | irisout÷Vanilla | 中央値差の95%区間（ms） | 判定 |
| --- | ---: | ---: | ---: | ---: | --- |
${vanillaTable}

同じ試行の組を5,000回再抽出して中央値差（irisout−Vanilla）の95%区間を求め、0を含む場合は差未確定とする。再抽出は初期値42の線形合同法（1664525、1013904223、32ビット）を使う。複数項目の同時検定に対する補正はせず、この環境での判断材料とする。

全試行値と生成物のSHA-256は[vanilla-comparison.json](./vanilla-comparison.json)を参照。公式測定ではログを抑止していない。
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
  path.join(root, `results${suffix}.json`),
  JSON.stringify({ environment, samples }, null, 2) + '\n',
)
fs.writeFileSync(
  path.join(root, `results${suffix}.md`),
  report
    .replaceAll('results.json', `results${suffix}.json`)
    .replaceAll('optimization.json', `optimization${suffix}.json`)
    .replaceAll('vanilla-comparison.json', `vanilla-comparison${suffix}.json`),
)
console.log(report)
