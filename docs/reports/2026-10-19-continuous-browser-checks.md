# 変更ごとのブラウザー操作検査

2026-10-19。`bun run test:browser`を追加し、保存済みの4検査器を変更ごとのCIへ接続した。公開物の構築と梱包、別ディレクトリーへの導入、型検査、本番構築、空きポートでの起動、操作検査、終了処理を1コマンドで実行する。検査器の不合格は終了コード1になる。GitHub Actionsへの送信と遠隔実行は行っていない。

## 実装と実行方法

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium bun run test:browser
```

`scripts/browser-checks.mjs`は既存のハンドラー、初期化・破棄、関数境界の検査器を直列に実行する。その後、`scripts/build-packages.mjs`と`bun pm pack`で公開物を作り、`skills/irisout/assets/incident-dogfood/`の一時コピーへ導入する。型検査と本番構築の後、`DOGFOOD_PORT=0`でOSに空きポートを割り当てさせ、URLの出力とHTTP 200を待って既存の障害対応ボード検査を実行する。

子プロセスには実行中のBunの実体パスを使い、package scriptからの`bun`も一時の実行ファイル参照で同じ版へ固定する。作業場所で版を切り替えるshimを経由しない。依存を差し替えたコピー先のlockだけを除き、再解決する。形式2の原lockをBun 1.3.13の`--frozen-lockfile`へ渡さない。新しい依存や汎用の試験実行基盤は追加していない。

結果は`.artifacts/browser-checks/run-*/`へまとめる。`IRISOUT_BROWSER_ARTIFACTS`で保存先を選べる。4検査器のJSON、各コマンドのログ、生成物、画面画像、全体の`summary.json`を保存する。CIは既存のChromium解決後に同じコマンドを実行し、失敗時は`actions/upload-artifact`でこのディレクトリーを保存する。隠しディレクトリーも保存対象に指定した。

CIの主シナリオは原利用例とする。試用Bは、検査器修正の補助確認として次で実行した。同じ8項目のために別の依存導入と本番構築を毎回繰り返す費用を避け、BをCIの追加シナリオにはしていない。

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/irisout-benchmark-chrome \
  bun run test:browser --incident-app fixtures/published-incident-dogfood/attempts/b
```

## 受信数の探索と保存ソースの構築

項目7はラベル`受信数`で名前を付けた出力を優先し、その出力がなければ本文の`受信数: 数値`を読む。値が0から始まり、イベント1回後に1になることを確認する。一覧・詳細の移動では文書の識別値を維持し、監視数0→1→0→1→0→1→0を確認する。最後の一覧へ戻った後の0も確認へ加えた。

原利用例の別の一時コピーでは`aria-label="受信数"`だけを除き、本文表記から読む経路も8/8で確認した。`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/irisout-benchmark-chrome IRISOUT_BROWSER_ARTIFACTS=/tmp/irisout-browser-text-run bun run test:browser --incident-app /tmp/irisout-browser-text-source`で実行した。[本文表記のみの原結果](./evidence/2026-10-19-continuous-browser-checks/text-only/incident.json)を保存した。原利用例とBのラベル付き出力の0→1とは別に、本文の0→1と監視数を確認している。

最初の試用Bの構築で、一覧の子要素と`{' '}`の混在が反応的な本文の診断に触れた。[構築失敗の原ログ](./evidence/2026-10-19-continuous-browser-checks/b-before/build-app.log)を残した。最小例は`<main><span>before</span>{" "}<span>after</span></main>`である。`git archive v0.3.7 packages`でタグのソースを別ディレクトリーへ展開して確認し、修正前の現行版と同じ拒否を確認した。[照合結果](./evidence/2026-10-19-continuous-browser-checks/static-string.json)を参照する。第3段階による退行とは扱わない。

文字列リテラルだけの式を静的な本文へ分け、HTMLの区切り文字をエスケープしてから初期HTMLへ出力するよう修正した。要素の間の文字列と`<strong>&</strong>`が要素として解釈されないこと、mount/hydrate、同じキーの行更新を2件の回帰試験で確認した。修正は`06b6290`へ独立して確定した。

`fixtures/published-incident-dogfood/attempts/{a,b}/`、固定依存と原lock、`evidence/{a,b}/`の原結果は変更していない。保存時のBの7/8と、今回の検査器・ソース版の8/8は別の結果である。公開版を使った当時の原実行の再採点はしていない。

## 全操作の結果

ローカルではBun 1.3.13、Linux/NixOS、Chrome for Testing 153.0.8010.12を使用した。`/tmp/irisout-benchmark-chrome`は必要な共有ライブラリーを設定してChromeを起動する入口である。以前指定していたNix Chromium 154のパスは存在しなかった。最初の制限環境では待受けが拒否されたため、ローカルの待受けとブラウザー起動を許可した実行へ切り替えた。

| 検査                                     | 原利用例          | 試用B             | 証拠                                                                                                                                                         |
| ---------------------------------------- | ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ハンドラーの返却・例外・非同期更新・解除 | 8/8               | 8/8               | [原利用例](./evidence/2026-10-19-continuous-browser-checks/original/handlers.json)、[B](./evidence/2026-10-19-continuous-browser-checks/b/handlers.json)     |
| 初期化の返却分岐・finally・破棄の所有    | 8/8               | 8/8               | [原利用例](./evidence/2026-10-19-continuous-browser-checks/original/lifecycle.json)、[B](./evidence/2026-10-19-continuous-browser-checks/b/lifecycle.json)   |
| 関数値の別名・引数・返却と生成名の衝突   | mount/hydrate成功 | mount/hydrate成功 | [原利用例](./evidence/2026-10-19-continuous-browser-checks/original/boundaries.json)、[B](./evidence/2026-10-19-continuous-browser-checks/b/boundaries.json) |
| 障害対応ボードのHTTPと画面               | 8/8               | 8/8               | [原利用例](./evidence/2026-10-19-continuous-browser-checks/original/incident.json)、[B](./evidence/2026-10-19-continuous-browser-checks/b/incident.json)     |

| 障害対応ボードの項目                          | 原利用例 | 試用B |
| --------------------------------------------- | -------- | ----- |
| 1. JavaScript無効の初期HTMLと詳細件名         | 成功     | 成功  |
| 2. 初期API、600ms/30msの検索遅延、未知IDの404 | 成功     | 成功  |
| 3. 検索応答の競合で後の検索結果を保持         | 成功     | 成功  |
| 4. HTTP 503の表示と次の検索による回復         | 成功     | 成功  |
| 5. 解決APIと一覧・再読み込みへの反映          | 成功     | 成功  |
| 6. ID別メモの分離と遷移・再読み込み後の保持   | 成功     | 成功  |
| 7. 同じ文書で監視数0→1→0→1→0→1→0、受信数0→1   | 成功     | 成功  |
| 8. 検索要求中の詳細遷移とキーボード操作       | 成功     | 成功  |

すべてのブラウザー例外は0件だった。[原利用例の実行記録](./evidence/2026-10-19-continuous-browser-checks/original/summary.json)と[Bの実行記録](./evidence/2026-10-19-continuous-browser-checks/b/summary.json)には、梱包、導入、型検査、構築、検査器の終了コードとサーバー停止を記録した。画像と再生成できる梱包物はGitへ保存せず、ローカルの出力先に残している。

## 不合格と途中終了の検証

原利用例を`/tmp/irisout-browser-failure-source`へコピーし、詳細の`const received = signal(0)`だけを`signal(2)`へ変えた。保存した利用例は変更していない。

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/irisout-benchmark-chrome \
  IRISOUT_BROWSER_ARTIFACTS=/tmp/irisout-browser-failure-run \
  bun run test:browser --incident-app /tmp/irisout-browser-failure-source
```

観測用の一時スクリプト`bun /tmp/check-browser-failure.mjs`からこのコマンドを起動した。`ps -eo pid=,ppid=,pgid=,stat=,args=`を100ms間隔で読み、開始前にいなかったChrome系のプロセスを記録した。全体と障害対応ボード検査器の終了コードは1で、項目7だけが`詳細の受信数が0から始まりません`となった。失敗画像も生成した。終了後はサーバーPIDが消失し、URLへの接続は失敗し、一時導入先も存在しなかった。今回観測したChrome系63プロセスは残っていなかった。[不合格の原結果](./evidence/2026-10-19-continuous-browser-checks/failure/incident.json)、[終了記録](./evidence/2026-10-19-continuous-browser-checks/failure/summary.json)、[停止確認](./evidence/2026-10-19-continuous-browser-checks/failure/cleanup.json)を保存した。

Chrome本体は検査器と異なるプロセス群を作っていた。通常の不合格では各検査器の`finally`による`browser.close()`で停止した。別に`bun /tmp/check-browser-interrupt.mjs`で、ハンドラー検査のChrome起動を観測して`browser-checks.mjs`本体へSIGTERMを1回送った。全体の終了コードは1となり、観測したChrome系7プロセスの残留は0だった。[途中終了の停止確認](./evidence/2026-10-19-continuous-browser-checks/interrupt/cleanup.json)を保存した。これはLinux上のSIGTERMを1回確認した結果である。SIGINT、SIGKILL、OS停止、すべての起動段階での中断は実行していない。

## 直列に実行した検証と未確認範囲

- `git commit -m "Render static string expressions between child elements"`のフック: `bun run check`成功、全56ファイル606試験成功。追加前の604試験に回帰試験2件を加えた。
- 上記の原利用例、試用B、不合格例、SIGTERMの各実行: 成功と終了コード・停止を確認した。生成物を作る処理は同時実行していない。
- `bun run build`、`bun run pack:smoke`、`bun run site:check`、`bun run site:test`、`bun run build:web`: この順で実行し、すべて成功した。文書試験は5/5だった。
- 最終コミットのフックでも`bun run check`と全606試験が成功した。検査は省略していない。静的検査の既存の警告は修正対象へ含めていない。
- CI設定はローカルでYAMLを読み、検査コマンドと失敗時の成果物保存を確認した。GitHub Actionsの実行と成果物取得は未確認である。
- 画像の画素比較、配置崩れ、性能測定、人間による試用、npm公開版の再実行は対象外である。ブラウザー操作の成功からこれらの達成は主張しない。

第3〜5段階の関連記録は[JavaScriptの関数境界](./2026-10-19-javascript-boundaries.md)、[性能最適化の採否基準](./2026-10-19-performance-adoption.md)、本報告である。
