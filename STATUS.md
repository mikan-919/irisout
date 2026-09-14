# irisout 実装ステータス

実装の現在地、完了した段階、既知の制約を記録する。設計判断は`docs/adr/`、受入条件は
`openspec/specs/`、今後の作業は`ROADMAP.md`を正本とする。

## 現在地（2026-09-14）

ソース版とnpm公開版は0.2.2である。0.2.2は文書とアプリ開発用スキルを更新し、公開入口と生成コードは変更していない。0.2.1では状態更新を
`signal((previous) => next)`へ統一し、`signal(initial, keyOf)`と`.update()`を削除した。
配列更新は一覧全体を再調整し、要素の識別とDOM再利用にはJSXの`key`を使う。

公開物は`packages/irisout`の単一パッケージである。コンパイラ、実行時処理、Vite連携の
ソースは責務別のディレクトリに置くが、内部パッケージとしては梱包しない。旧JavaScript実装は
移植完了により削除した。履歴はJujutsuとGitから参照できる。

公式サイトと共有Playgroundの計画は、第0段階（文書8分類、Counter・List・SVGの例、
`docs/getting-started.md`の正本、SSR入口、hydrate state、限定共有、投稿JSXの非実行）の範囲を
2026-09-14に固定した。第1段階の文書SSGは、`docs/getting-started.md`を正本とした静的HTML、
文書一覧・目次・前後リンク、タイトルと見出しの検索索引、参照検査、公式例の版検査、CI接続まで
実装した。公式例は同じJSXから文書表示用コードと後続Playground接続用`examples.json`を生成する。
Playground画面がこの索引を読む処理、隔離実行、保存・共有は後続段階である。

2026-09-14にSSR入口の試作を実装した。`irisout/ssr`の`irisoutSsr()`は指定したルート部品から
要求単位の`render(input) -> { html, state }`を生成し、入力、テキスト、属性、条件分岐、一覧、
局所signalを扱う。必須入力は要求時だけ評価し、局所signal初期値をstateからhydrateへ復元する。
`serializeSsrState()`はJSON値を検査してscript埋込み用にescapeする。イベント、`onMount`、`effect`、
`use=`はサーバーで実行せず、module共有state、相対module、外部module、構造unit内の`signal()`/
`derived()`は`compile:` scope limitで拒否する。SSRの局所signalはルート部品直下に限る。hydrateと
mountのstate引数は`render()`の返値専用で、入力値との推測を行わない。A/B並行要求と失敗後の正常要求を確認した。404・503の判定は要求層へ移管した。

## 段階

| 段階           | 状態 | 結果                                                   |
| -------------- | ---- | ------------------------------------------------------ |
| M1〜M6         | 完了 | 状態、イベント、静的HTML、属性、構造単位、横断試験     |
| 部品合成       | 完了 | 同一ファイル、相対module、直接のchildren位置、局所状態 |
| ライフサイクル | 完了 | `use=`、`onMount`、`effect`、破棄、部品インスタンス    |
| Context        | 完了 | インスタンス単位の静的置換、構造単位のprovider         |
| SVG            | 完了 | SVG要素、`foreignObject`、静的名前空間属性             |
| 共有状態       | 完了 | module共有signal/derived、複数インスタンスへの同期通知 |
| R1             | 完了 | 元ファイル位置を含む診断と実行時ソースマップ           |
| R2             | 完了 | Workerを使うヒートマップ利用例と操作・性能検証         |
| R3             | 完了 | 1万件一覧の初期化を同一条件で14.5%短縮                 |
| R4             | 完了 | 単一npmパッケージ、外部梱包検査、隔離試用              |

作者以外の人間による手動試用は未実施である。隔離したエージェントによる導入、型検査、
本番ビルド、開発サーバー、状態更新、条件分岐、一覧、ファイル分割、診断修正は確認済みである。

2026-09-13に`app/web`をNix版Chromiumで操作し、メニュー、Counter、List、SVGの切り替えを
確認した。この確認で、開発時の依存走査（開発サーバーがimport先を事前に調べる処理）が実パスの
仮想モジュールを実ファイルとして読む問題を再現したため、開発時はNUL形式、本番はソースマップを
合成できる実パスを使うようVite連携を修正した。公開導入案内のnpm登録状態も修正した。

同日に`yt-util`の移植作業コピーで、公開版`irisout@0.2.2`を使った一覧・プレイリスト詳細・
動画選択・検索・視聴済み保存の構成をビルドした。未認証画面はChromiumで確認し、認証済みAPIは
一時SQLiteと試験データで確認した。Hono RPC、Better Auth、Bun配信を同じ構成で接続し、開発時の
直接URLと本番時の直接URLを確認した。公開版の仮想モジュールを依存走査から除外する設定は、
次回のirisout公開後に再確認する。

同日に第3段階として、類似度による並べ替え、視聴済み動画の末尾移動、いいね・削除の保留と適用を
追加した。Hono RPCの応答へプレイリスト項目IDを含め、同じ動画IDの重複を区別する。認証済みAPIは
一時SQLiteと試験用セッションで並べ替え、`watch_order`保存、削除の部分成功を確認した。画面は
固定行高の仮想一覧を追加した。yt-util側へPlaywrightの固定データ比較を追加し、同じChromiumと
100・1000・10000件の入力で、初期表示、検索、選択、スクロールを測定した。10000件では初期表示
190.8ms、検索4.6ms、表示行数はirisout側16行、Next.js側10行だった。条件と数値はyt-utilの
`docs/playlist-performance.md`に記録した。

2026-09-14に第4段階として、埋め込み生成と書き出しをHono経路へ移した。GeminiはSSEで開始・進捗・
完了・失敗を返し、ブラウザ内モデルは生成したベクトルを同じキャッシュへ保存する。書き出しは
クォータ見積もりと確認を経て非公開プレイリストを作成し、追加順を保ちながら項目ごとの失敗を
通知する。認証、所有確認、キャッシュ、SSE、部分失敗は一時SQLite、試験用生成器、YouTube応答で
確認した。実際のGeminiキー、モデル重み、YouTubeアカウントへの書き込みは未実施である。画面破棄
時は`pagehide`で要求を中断し、ルートの破棄用ハンドルが公開されていない制約を踏まえた実装にした。

同日の画面確認で、動的な`disabled`を通常属性へ`false`として設定すると、HTMLの真偽属性の規則に
よりボタンが常に無効になる不具合を発見した。`checked`と同じDOMプロパティへ生成するよう修正し、
生成物の実DOM試験とyt-utilの接続画面をChromiumで確認した。

2026-09-14にブラウザ用コンパイラ入口を実装した。`irisout/browser`は単一JSXの文字列だけを
受け取り、`compile()`と同じ初期HTML・生成コード・診断を返す。source-onlyの解析本体をNodeの
ファイル読込みとmodule linkerから分離し、梱包済み`browser.js`に`node:fs`、`node:path`、module
linkerが含まれないことを依存検査で確認した。静的・動的import、外部資源importはブラウザ境界で
`compile:` scope limitとして拒否する。tarballの別ディレクトリ導入とWorker実行も確認した。

同日にPlaygroundの編集・実行を実装した。公式サイトは`app/web`の入力欄だけを所有し、別配信元の
`playground-controller.html`が実行ごとのWorkerと結果iframeを所有する。Workerは5秒で破棄し、
生成結果は1 MiBまで、結果iframeは`sandbox="allow-scripts"`と`connect-src 'none'`を使う。
親画面と実行管理画面は送信元・形式・サイズ・実行番号を検査し、診断文字列は`textContent`へ表示する。
`bun run test:web:playground`で別配信元のCookie境界、CSP、例外、無限ループ、外部通信、フォーム、
上位遷移、ポップアップ、ダウンロード、連続実行、停止後の再実行をChromiumで確認した。実行管理側の
CSPにはコンパイラが`new Function()`を使うため`unsafe-eval`が必要であり、これはWorkerを含む配信元へ
限定する。共有機能を公開する前に、実運用の隔離配信元へ同じヘッダーとブラウザー試験を適用する。

## 検証

- `bun run check`: 書式、静的検査、TypeScriptとauthored JSXの型検査。
- `bun run test`: コンパイラ、実DOM、生成物、別アプリの統合試験。
- `bun run build`: 利用例の本番ビルド。
- `bun run build:packages`: `irisout`のJavaScriptと型定義を生成。
- `bun run pack:smoke`: 一時ディレクトリへ梱包物を導入して型検査、本番ビルド、
  初期HTML、イベント生成、ソースマップ、workspace依存の不存在を確認。
- `bun run registry:smoke`: npm公開版0.2.2に同じ隔離検査を適用。

時間とメモリの測定は環境差を含むため、同じ生成物、Chromium、入力、反復数の比較だけを
採否に使う。R3の最終値と判断理由はADR-0044〜0046、ヒートマップの測定条件は
`packages/bench/heatmap.results.md`に記録する。

## 既知の制約

- `compile()`は、他の部品から参照されないトップレベル関数を一つ要求する。
- `compile()`は初期HTMLの生成中に入力由来の処理を実行する。共有Playgroundでは投稿ソースを
  サーバーの診断処理へ渡さず、`irisout/browser`をWorkerなどの隔離した実行単位から呼び出す。
  外部通信や結果表示の権限分離は`playground-isolated-execution`の責務である。
- `compile()`のトップレベルは関数宣言とcontext keyに限る。`compileProject()`は相対
  `.js`/`.jsx`の静的importを連結し、外部moduleとVite資源importは生成物へ残す。
- dynamic import、re-export、module循環、名前空間による相対importは対象外である。
- 部品入力は一つのshorthand分割代入を使う。別名、spread、複数仮引数は対象外である。
- `children`は部品本体のJSXにある直接の子位置でだけ使える。自己再帰と相互再帰は対象外である。
- 動的属性は`checked`、`disabled`、`value`をDOMプロパティへ、その他を属性へ反映する。動的な
  名前空間属性は対象外である。
- ハンドラの`try`、ループ、`switch`など、更新位置を静的に決められない制御フローは
  `compile: ... (scope limit)`で拒否する。
- `use=`は一要素につき一つで、反応的な引数の再評価は行わない。
- Contextは静的に解決する。実行時provider探索、非同期予定表、永続化は持たない。
- Vite連携はビルド時に作った静的HTMLをブラウザで引き継ぐ。要求ごとのサーバー描画は
  別契約である。
- SSR入口のstateは配列、`null` prototypeまたは`Object.prototype`のobject、有限number、string、
  boolean、`null`だけを受け付ける。`Map`、`Set`、`Date`、`toJSON`、function、symbol、循環参照、
  accessor propertyは対象外である。
- 初期SSRは単一module入口に限る。構造unit内の`signal()`と`derived()`は対象外で、ルート部品直下の
  signalだけstateへ保存してhydrateする。
- ルート入力bindingが生成moduleの内部名と衝突する場合は`compile:` scope limitで拒否する。
- SSR仮想moduleのsource mapは未実装で`null`を返す。404・503で正常ページ用stateを生成しない
  判定は要求処理層の責務である。
- 実行時ソースマップはイベント処理、`use=`、`onMount`、`effect`の処理文を対象とする。
  DOM探索、一覧照合、自動生成した更新関数には一対一の元構文がないため対応しない。
- Playgroundは単一`.jsx`とブラウザーが提供する組込み機能だけを受け付け、任意のnpm依存、複数
  ファイル、保存・共有APIは未接続である。実行管理画面は保存APIを持たない別配信元へ置き、
  実運用のCSP `frame-ancestors`、runtime資産のCORS、Workerを含む配信ヘッダーを環境ごとに固定する。

対応範囲の詳細と拒否例は`docs/getting-started.md`、`docs/architecture.md`、
`openspec/specs/`を参照する。
