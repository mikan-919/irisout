// 測定の生データから中央値と比較表を作り、測定条件を同じ文書へ記録する。
import fs from 'node:fs'
const root = import.meta.dirname
const data = JSON.parse(fs.readFileSync(root + '/results.json'))
if (!data.visibleContentEqual) throw new Error('両実装の機能・表示確認が完了していません')
const a = data.targets.irisout
const b = data.targets.rshono
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const ms = (n) => n.toFixed(2)
const kb = (n) => (n / 1024).toFixed(2)
const mib = (n) => (n / 1048576).toFixed(2)
const ratio = (a, b) => (a / b).toFixed(2)
const rows = []
rows.push(
  '# irisout と rshono の比較測定',
  '',
  `測定開始: ${data.date}。同一端末で順番に実行。値は今回の測定用アプリに限る。`,
  '',
  '## 対象と条件',
  '',
  `- irisout 0.3.5、コミット \`${data.environment.irisoutCommit}\` の公開パッケージ生成物。\`irisout/hono\` と \`irisout/hono/vite\` を使用。`,
  `- rshono は公開パッケージ \`@rshono/core@1.0.0-rc.24\`。測定用アプリと負荷生成器は [上流リポジトリ](https://github.com/rshono/rshono/tree/${data.environment.rshonoCommit}/packages/benchmarks) のコミット \`${data.environment.rshonoCommit}\`。公開パッケージとGitソースの同一性は検証していない。`,
  `- ${data.environment.cpu}、${data.environment.cpus}論理CPU、Linux、Node.js ${data.environment.node}、Bun ${data.environment.bun}、Chromium ${data.environment.chromium}。`,
  '- 同じ100件のデータ、同じCSS、同じ本文、カウンター・絞り込み・登録要求。本文の一致、100行の描画、要求ヘッダーによる動的描画、登録の成功と2種類の入力エラーを検証。',
  '- 同じNode用HTTP配信器 @hono/node-server 2.1.1、同じHono 4.13.8。',
  '- JavaScriptの古い世代のヒープ上限は256 MiB。サーバーは各1プロセス。圧縮なしで受信し、各応答に同じ gzip level 9 / Brotli quality 11 を適用。',
  '',
  '## 初回転送量',
  '',
  '単位はKiB（1 KiB = 1,024バイト）。新しいブラウザーページが操作前に取得したHTML・JavaScript・CSSの合計。JavaScript列は外部ファイルのみで、HTML内の状態データは合計に含む。通信ヘッダーは含まない。',
  '',
  '| 経路 | irisout 未圧縮 | rshono 未圧縮 | irisout gzip | rshono gzip | irisout Brotli | rshono Brotli | irisout JS gzip | rshono JS gzip | 要求数 irisout / rshono |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
)
for (const route of ['/', '/ssr', '/interactive']) {
  const x = a.payload[route],
    y = b.payload[route]
  const js = (r) =>
    r.responses.filter((v) => v.type === 'script').reduce((sum, v) => sum + v.sizes.gzip, 0)
  rows.push(
    `| ${route} | ${kb(x.totals.raw)} | ${kb(y.totals.raw)} | ${kb(x.totals.gzip)} | ${kb(y.totals.gzip)} | ${kb(x.totals.brotli)} | ${kb(y.totals.brotli)} | ${kb(js(x))} | ${kb(js(y))} | ${x.responses.length} / ${y.responses.length} |`,
  )
}
rows.push(
  '',
  '## ビルドと起動',
  '',
  '各3試行の中央値。初回ビルドは生成物とアプリのキャッシュを削除した状態。再ビルドは同じ入力とキャッシュを保持する。依存導入とirisoutパッケージ自体のビルドは計時外。起動はプロセス生成から最初の正常なAPI応答まで。確認間隔50msを含むため、起動時間の差の解像度は50ms程度。',
  '',
  '| 指標 | irisout ms | rshono ms |',
  '| --- | ---: | ---: |',
  `| 初回ビルド | ${ms(median(a.buildColdMs))} | ${ms(median(b.buildColdMs))} |`,
  `| 入力変更なしの再ビルド | ${ms(median(a.buildWarmMs))} | ${ms(median(b.buildWarmMs))} |`,
  `| プロセス起動 | ${ms(median(a.startupMs))} | ${ms(median(b.startupMs))} |`,
  '',
  '## 負荷時の処理件数と応答時間',
  '',
  '16接続、4測定用ワーカースレッド、各試行1秒の予熱後2秒測定、各経路3試行。処理件数は件/秒、時間はms。p50は応答時間の中央値、p99は99%の応答が収まる時間。表は試行ごとの統計値の中央値。全試行で通信エラー・HTTPエラーは0件。',
  '',
  '| 経路 | irisout 件/秒 | rshono 件/秒 | 件数比 irisout/rshono | irisout p50 | rshono p50 | irisout p99 | rshono p99 |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
)
for (const route of Object.keys(a.load)) {
  const x = a.load[route],
    y = b.load[route]
  const rateA = median(x.map((r) => r.rps)),
    rateB = median(y.map((r) => r.rps))
  rows.push(
    `| ${route} | ${Math.round(rateA)} | ${Math.round(rateB)} | ${ratio(rateA, rateB)} | ${ms(median(x.map((r) => r.latencyMs.p50)))} | ${ms(median(y.map((r) => r.latencyMs.p50)))} | ${ms(median(x.map((r) => r.latencyMs.p99)))} | ${ms(median(y.map((r) => r.latencyMs.p99)))} |`,
  )
}
rows.push(
  '',
  '## メモリ',
  '',
  '単位はMiB。RSSはOSが報告するプロセスの常駐メモリで、未回収のごみやネイティブ領域を含む。各段階1回の観測であり、保持量やリークの測定ではない。同じサーバーで / → /ssr → /interactive → /api/health の順に測定している。',
  '',
  '| 段階 | irisout | rshono |',
  '| --- | ---: | ---: |',
)
for (const stage of Object.keys(a.rss))
  rows.push(
    `| ${stage === 'idle' ? '起動後' : stage + ' 負荷後'} | ${mib(a.rss[stage].bytes)} | ${mib(b.rss[stage].bytes)} |`,
  )
rows.push(
  `| ブラウザーJSヒープ（機能確認後、強制GC済み） | ${mib(a.browserHeapUsedBytes)} | ${mib(b.browserHeapUsedBytes)} |`,
  '',
  'ブラウザーのヒープは1回の観測で、DOMのネイティブメモリは含まない。',
  '',
  '## 結果の範囲',
  '',
  `対話ページの初回gzip転送量はirisoutが${(100 * (1 - a.payload['/interactive'].totals.gzip / b.payload['/interactive'].totals.gzip)).toFixed(1)}%少ない。100件の動的ページの処理件数比は${ratio(median(a.load['/ssr'].map((r) => r.rps)), median(b.load['/ssr'].map((r) => r.rps)))}倍。対話ページは${ratio(median(a.load['/interactive'].map((r) => r.rps)), median(b.load['/interactive'].map((r) => r.rps)))}倍で、動的一覧ほどの差はない。起動はrshonoが短い。`,
  '',
  '- irisoutはReact Server Componentsの直列化・復号・ストリーミングを実装しない。登録はJSON APIで、rshonoはサーバーアクションで行う。画面の操作結果は同じでも、提供する仕組みは同一ではない。上流仕様の「両実装がRSCを使う」という条件は満たさない。',
  '- irisoutの静的ページはビルドスクリプトがHTMLを保存する。rshonoは静的経路の公式事前描画を使う。irisoutのSSRも既定の経路用JavaScriptを含め、状態データを転送する。読み取り専用ページの転送量を0 JSへ最適化した比較ではない。',
  '- irisoutのサーバーは起動時に公式Hono入口がJSXをコンパイルする。rshonoはビルド済みのサーバーを読み込む。この差は起動時間に含めた。',
  '- 生成物のサイズはJSONに記録したが、irisoutはサーバーと依存を外部に持ち、rshonoはサーバー生成物をdistへ置くため、配備サイズとして比較できない。導入サイズ・開発サーバー起動・初回描画時間・操作の遅延・経路遷移・実際のサーバーレス起動は未測定。',
  '- 1台でirisoutを先に測定した短時間の比較。測定用ワーカーとサーバーはCPUを共有する。端末の状態、順序、HTTP層、依存版による差を含むため、全アプリの優劣には一般化しない。生の試行値はresults.jsonに保存。',
  '',
  '## 再実行',
  '',
  'リポジトリの依存をBunで導入済みの環境で実行。setupは比較対象を /tmp に作り、固定版の依存を導入する。測定は両サーバーを同じNode.jsで動かすため、BunからNode.jsのスクリプトを呼ぶ。',
  '',
  '```sh',
  'bun packages/bench/rshono/setup.mjs',
  'bun run bench:rshono',
  '```',
  '',
  '作業ディレクトリは RSHONO_CHECKOUT と RSHONO_APP で変更できる。Chromiumの場所は PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH で指定できる。NixOSでは既存の測定と同じく nixpkgs#chromium を使う。移植したデータとCSSの権利表示は UPSTREAM-LICENSE に保存。',
)
rows.push(
  '',
  '## 検証',
  '',
  '- 表示本文の一致、一覧件数、動的描画、対話操作をChromiumで検証済み。既存の333試験が通過し、vp checkはエラー0件。警告は既存の16件と、文字列入力のFormData値をStringへ変換する測定用画面の2件。',
  '- vlmkit 0.23.0 の追加描画検査は実行未完了。Playwright付属ブラウザーの起動時に `error while loading shared libraries: libglib-2.0.so.0: cannot open shared object file: No such file or directory` で終了した。測定用スクリプトが使うNixOS Chromiumでの機能検証とは別の検査である。',
)
fs.writeFileSync(root + '/results.md', rows.join('\n') + '\n')
