// 通知と交換の照合を削減した版について、生成物と全試行を照合して同期時間を集計する。
import fs from 'node:fs'
import { strict as assert } from 'node:assert'
const root = import.meta.dirname
const read = (name) => JSON.parse(fs.readFileSync(`${root}/${name}`, 'utf8'))
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2
}
// residual-report.mjsと同じ、対応する試行の組を再抽出する95%区間。
function compare(before, after) {
  let seed = 42
  const differences = []
  for (let run = 0; run < 5000; run++) {
    const a = [],
      b = []
    for (let i = 0; i < before.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const index = Math.floor((seed / 4294967296) * before.length)
      a.push(before[index])
      b.push(after[index])
    }
    differences.push(median(b) - median(a))
  }
  differences.sort((a, b) => a - b)
  const interval = [differences[125], differences[4875]]
  const a = median(before),
    b = median(after)
  return {
    before: a,
    after: b,
    difference: b - a,
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
const verification = read('notification-verification.json')
assert.equal(verification.checks.unitTests, 542)
assert.equal(verification.checks.staticChecks, 'pass (18 existing warnings)')
const inputs = [
  ['変更前→変更後', 'notification-optimization.json', verification.beforeSha256],
  ['Vanilla→変更後', 'notification-vanilla.json', verification.vanillaSha256],
]
const analysis = []
const markdown = [
  '# 通知と固定位置交換の処理削減',
  '',
  '専有一覧だけの更新では、通知先がない間に更新取引の開始・終了を省く。単独の原子的な固定位置交換では、取引外で有効な添字順がある場合に行と配列の再照合、長さの一致、親の存在、実行時の隣接判定を省く。添字範囲の検査と失敗前の順序無効化は維持する。通知中の再入は従来処理を使う。',
  '',
  '同じ長さの新配列を設定してから通知が例外になった場合と、通知中に最後の通知先を解除して再入する場合も検査する。通知先の登録・解除はmount後にも反映する。',
  '',
  '全9操作各100試行。各試行で比較順を交互にし、3回の事前実行後に測定する。単位はミリ秒。同期したクリック処理とDOM書込みだけを測り、配置計算・描画は含まない。中央値の差の95%区間は対応する試行を5,000回再抽出して求める（乱数の初期値42）。1e-7ms以下の丸め誤差を差と判定しない。',
  '',
]
for (const [title, file, beforeHash] of inputs) {
  const data = read(file)
  assert.deepEqual(Object.keys(data.samples), Object.keys(names))
  assert.equal(data.artifacts[0].length, 1)
  assert.equal(data.artifacts[1].length, 1)
  assert.equal(data.artifacts[0][0].sha256, beforeHash)
  assert.equal(data.artifacts[1][0].sha256, verification.afterSha256)
  const values = {}
  markdown.push(
    `## ${title}`,
    '',
    `[全試行値](./${file})。`,
    '',
    '| 操作 | 前 | 後 | 差の95%区間 | 判定 |',
    '| --- | ---: | ---: | --- | --- |',
  )
  for (const [key, label] of Object.entries(names)) {
    const [before, after] = data.samples[key]
    for (const samples of [before, after]) {
      assert.equal(samples.length, 100)
      assert(samples.every((value) => Number.isFinite(value) && value >= 0))
    }
    const result = (values[key] = compare(before, after))
    markdown.push(
      `| ${label} | ${result.before.toFixed(5)} | ${result.after.toFixed(5)} | [${result.interval.map((value) => value.toFixed(5)).join(', ')}] | ${result.verdict} |`,
    )
  }
  analysis.push({ title, file, artifacts: data.artifacts, values })
  markdown.push('')
}
const [beforeAsset] = analysis[0].artifacts[0],
  [afterAsset] = analysis[0].artifacts[1]
markdown.push(
  '## 検証と範囲',
  '',
  '全542試験、書式・静的検査・型検査、梱包物の利用側での構築、公式2実装のキー付き判定、既存の8操作を検証した。通知先がない交換のDOM移動は従来と同じ最大2回で、削減対象はその前後のJavaScript処理である。',
  '',
  `生成JavaScriptは${beforeAsset.bytes}→${afterAsset.bytes}バイト、gzipでは${beforeAsset.gzipBytes}→${afterAsset.gzipBytes}バイトへ増えた。通知・再入・失敗後の復旧経路に加えて、通知がない場合の直接交換を生成するためである。`,
  '',
  '生成物と試験の記録は`notification-verification.json`、全試行値は各表のJSONへ保存する。`notification-initial-pilot.json`は取引中の再入条件を追加する前の候補であり、最終版の値へ混ぜない。描画込みの公式時間とメモリは再測定していない。全操作でVanilla以下という目標の達成は主張しない。',
  '',
  '再集計: `bun packages/bench/js-framework/notification-report.mjs`。再測定はREADMEの`probe.mjs`を使い、`JSFB_PROBE_SAMPLES=100`を指定する。比較する生成物のSHA-256は検証記録へ合わせる。',
  '',
)
fs.writeFileSync(
  `${root}/notification-analysis.json`,
  JSON.stringify(
    { method: 'paired median bootstrap; 5000 resamples; seed 42; tolerance 1e-7 ms', analysis },
    null,
    2,
  ) + '\n',
)
fs.writeFileSync(`${root}/notification-results.md`, markdown.join('\n'))
console.log('notification comparison: verified')
