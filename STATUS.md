# irisout 実装ステータス

実装の現在地、完了した段階、既知の制約を記録する。設計判断は`docs/adr/`、受入条件は
`openspec/specs/`、今後の作業は`ROADMAP.md`を正本とする。

## 現在地（2026-09-17）

ソース版とnpm公開版は0.2.2である。0.2.2は文書とアプリ開発用スキルを更新し、公開入口と生成コードは変更していない。0.2.1では状態更新を
`signal((previous) => next)`へ統一し、`signal(initial, keyOf)`と`.update()`を削除した。
配列更新は一覧全体を再調整し、要素の識別とDOM再利用にはJSXの`key`を使う。

公開物は`packages/irisout`の単一パッケージである。コンパイラ、実行時処理、Vite連携の
ソースは責務別のディレクトリに置くが、内部パッケージとしては梱包しない。旧JavaScript実装は
移植完了により削除した。履歴はJujutsuとGitから参照できる。

公式サイトと共有Playgroundの計画は、第0段階（文書8分類、Counter・List・SVGの例、
`docs/getting-started.md`の正本、SSR入口、hydrate state、限定共有、投稿JSXの非実行）の範囲を
2026-09-14に固定した。第1〜5段階の実装と自動試験を完了し、6件の後続changeをarchiveへ移し、
受入条件を`openspec/specs/`へ反映した。文書SSGは静的HTML、文書一覧・目次・前後リンク、
タイトルと見出しの検索索引、参照検査、公式例の版検査、CI接続まで実装した。公式例は同じJSXから
文書表示用コードとPlayground接続用`examples.json`を生成する。ブラウザ用入口、隔離実行、保存・削除、
共有ページSSRも内部実装と自動試験を確認済みである。D1の復元と、作者以外の人間による手動試用は
未検証である。

2026-09-17に公式サイトと実行管理画面をCloudflare Workersへ分離して配信した。公式側は
`irisout-site.mikan-919.workers.dev`、実行管理側は`irisout-playground-run.mikan-919.workers.dev`である。
公式側はWorkers Assets、共有ページSSR、保存APIを一つのWorkerで扱い、共有値はAPACのD1
`irisout-playground`へ保存する。実行管理側は保存APIを持たず、公式Originだけを`frame-ancestors`へ
指定する。公開環境で公式ページ、実行管理CSP、専用資産の404、D1への保存、共有ページ表示、削除後の
404を確認した。同日に公開環境の実ブラウザーでPlaygroundの実行を確認した。D1の復元手順は
未確定である。

同日に1200×630のOG画像を追加し、ホーム、Playground、文書、共有ページのOpen Graphと
Twitter Cardメタデータへ接続した。公開WorkerでWebP画像、寸法、MIME型、メタデータを確認した。

2026-09-14にSSR入口を実装した。`irisout/ssr`の`irisoutSsr()`は指定したルート部品から
要求単位の`render(input) -> { html, state }`を生成し、入力、テキスト、属性、条件分岐、一覧、
局所signalを扱う。必須入力は要求時だけ評価し、局所signal初期値をstateからhydrateへ復元する。
`serializeSsrState()`はJSON値を検査してscript埋込み用にescapeする。イベント、`onMount`、`effect`、
`use=`はサーバーで実行せず、module共有state、相対module、外部module、構造unit内の`signal()`/
`derived()`は`compile:` scope limitで拒否する。SSRの局所signalはルート部品直下に限る。hydrateと
mountのstate引数は`render()`の返値専用で、入力値との推測を行わない。A/B並行要求と失敗後の正常要求を確認した。404・503の判定は要求層へ移管した。

2026-09-15に公開宣言を整理した。`CompileResult`と`irisout/state`から内部Babel AST型を切り離し、
tarballには`compiler/source.d.ts`、公開state宣言、`source-map.d.ts`など公開入口が参照する宣言だけを
梱包する。相対宣言参照は公開JavaScript入口へ解決し、`irisout/ssr`はVite+内部型を再公開しない。
隔離した外部プロジェクトで`irisout`、`irisout/browser`、`irisout/ssr`、`irisout/state`を
`skipLibCheck:false`で型検査し、本番構築まで確認した。

2026-09-15にauthored JSXの記述APIを`irisout`からの明示的な名前付きimportへ整理した。`signal`、`derived`、`render`などは公開入口の型宣言を使い、source parserとmodule linkerがコンパイル前にimportを取り除く。`irisout/jsx`から大域宣言を削除し、実例と型検査用入力を移行した。既存の`compile(source)`へ渡す裸の記述API名は互換性のため当面受理する。

2026-09-16にファイル経路とブラウザー遷移を実装した。`page.jsx`だけを走査し、`/`、`/users`、
`/users/:id`の共通経路表を作る。静的優先、動的衝突、末尾斜線、引数の一度だけの復号、検索引数、
不正な符号化、復号後の`/`、未一致をserverとclientで共有する。`irisout/hono`はprefix付きの
HonoサブルーターとしてpageをSSR targetへ接続し、page別loaderのparams、検索引数、Requestを
要求ごとに受け取る。loader結果だけを既存`render(input) -> { html, state }`へ渡し、直接HTML、遷移JSON、
404、redirect、500を分離した。`irisoutRoutes`はclient経路表とhydrate用page moduleを生成する。
初回stateを再取得せず、管理対象リンク、履歴、検索引数変更、旧画面の破棄、競合抑止、失敗時の
通常文書遷移を実DOM試験で確認した。公開bundle、宣言、tarball、Hono peer依存を更新した。

## 段階

| 段階               | 状態 | 結果                                                      |
| ------------------ | ---- | --------------------------------------------------------- |
| M1〜M6             | 完了 | 状態、イベント、静的HTML、属性、構造単位、横断試験        |
| 部品合成           | 完了 | 同一ファイル、相対module、直接のchildren位置、局所状態    |
| ライフサイクル     | 完了 | `use=`、`onMount`、`effect`、破棄、部品インスタンス       |
| Context            | 完了 | インスタンス単位の静的置換、構造単位のprovider            |
| SVG                | 完了 | SVG要素、`foreignObject`、静的名前空間属性                |
| 共有状態           | 完了 | module共有signal/derived、複数インスタンスへの同期通知    |
| R1                 | 完了 | 元ファイル位置を含む診断と実行時ソースマップ              |
| R2                 | 完了 | Workerを使うヒートマップ利用例と操作・性能検証            |
| R3                 | 完了 | 1万件一覧の初期化を同一条件で14.5%短縮                    |
| R4                 | 完了 | 単一npmパッケージ、外部梱包検査、隔離試用                 |
| ファイル経路・遷移 | 完了 | `page.jsx`走査、Hono SSR、loader、client遷移、tarball検査 |

作者以外の人間による手動試用は未実施である。隔離したエージェントによる導入、型検査、
本番ビルド、開発サーバー、状態更新、条件分岐、一覧、ファイル分割、診断修正は確認済みである。

2026-09-13に`apps/web`をNix版Chromiumで操作し、メニュー、Counter、List、SVGの切り替えを
確認した。この確認で、開発時の依存走査（開発サーバーがimport先を事前に調べる処理）が実パスの
仮想モジュールを実ファイルとして読む問題を再現したため、開発時はNUL形式、本番はソースマップを
合成できる実パスを使うようVite連携を修正した。公開導入案内のnpm登録状態も修正した。

同日の画面確認で、動的な`disabled`を通常属性へ`false`として設定すると、HTMLの真偽属性の規則に
よりボタンが常に無効になる不具合を発見した。`checked`と同じDOMプロパティへ生成するよう修正し、
生成物の実DOM試験と利用例の画面をChromiumで確認した。

2026-09-14にブラウザ用コンパイラ入口を実装した。`irisout/browser`は単一JSXの文字列だけを
受け取り、`compile()`と同じ初期HTML・生成コード・診断を返す。source-onlyの解析本体をNodeの
ファイル読込みとmodule linkerから分離し、梱包済み`browser.js`に`node:fs`、`node:path`、module
linkerが含まれないことを依存検査で確認した。静的・動的import、外部資源importはブラウザ境界で
`compile:` scope limitとして拒否する。tarballの別ディレクトリ導入とWorker実行も確認した。

同日にPlaygroundの編集・実行を実装した。公式サイトは`apps/web`の入力欄だけを所有し、別配信元の
`playground-controller.html`が実行ごとのWorkerと結果iframeを所有する。Workerは5秒で破棄し、
生成結果は1 MiBまで、結果iframeは`sandbox="allow-scripts"`と`connect-src 'none'`を使う。
親画面と実行管理画面は送信元・形式・サイズ・実行番号を検査し、診断文字列は`textContent`へ表示する。
`bun run test:web:playground`で別配信元のCookie境界、CSP、例外、無限ループ、外部通信、フォーム、
上位遷移、ポップアップ、ダウンロード、連続実行、停止後の再実行をChromiumで確認した。実行管理側の
CSPにはコンパイラが`new Function()`を使うため`unsafe-eval`が必要であり、これはWorkerを含む配信元へ
限定する。共有機能を公開する前に、実運用の隔離配信元へ同じヘッダーとブラウザー試験を適用する。

2026-09-15にPlaygroundの入力欄へMonaco Editor 0.56.0を導入した。TypeScript・JSX用の本体と言語定義、
TypeScript作業スレッドはPlayground初期化時に公式Originから遅延読込みし、Monacoの値を既存の入力、例選択、
保存、書き出し、実行へ同期する。型検査を行わず、Irisout固有の大域名を誤診断しないよう意味検査を無効にし、
構文の色分けだけを行う。Monaco本体またはTypeScript機能を読み込めない場合は元の`textarea`を残し、入力、
保存、書き出しを継続する。実行管理Originには投稿変換用の資産だけを置く境界を維持し、本番生成物と二つの
Vite+開発サーバーで表示、入力、実行を確認した。TypeScriptの型注釈・型別名・interface・ジェネリクスと
JSXタグ・属性・式の色分け、初期値、入力置換、例切替え、共有複製後の退避をChromiumで確認した。

2026-09-15に初期化の遅延境界を修正した。トップPlaygroundと共有ページからの複製経路は、公式例の
読込みと実行管理iframeの接続が完了するまでsourceを読取り専用にし、接続前の入力を例の初期値で
上書きしない。実行管理Originの設定不備時はsourceを保持したまま例の読込み後に編集、保存、書き出しを
許可し、実行だけを無効にする。応答遅延を入れたChromium試験で複製値と入力値の保持を確認した。

同日に本番Bun入口の静的配信を修正した。共有distを使う場合も、controller・Worker・実行runtime固有資産を
`assets/controller/`へ分離し、公式Originからcontroller HTMLと固有資産を取得できないようにした。公式Originの
保存APIと実行管理OriginのAPI不存在、CSP、設定由来`frame-ancestors`、`Permissions-Policy`、CORP、文書SSGの
直接URL、末尾slashの308、404、path traversal、不正なpercent encodingを実サーバー接続で確認した。

同日に本番Bun入口の`/playground`を既存のトップSSGへ接続した。共有SSR用の`playground.html`を編集画面として
返さず、`/playground`とクエリ付き要求から`data-playground-root`を持つHTMLを返す実装を確認した。`example`は
`examples.json`の登録済み識別子だけを初期選択に使い、不在・未知・重複値は先頭例へ戻す。連続slashと
符号化slashを含むcontroller専用資産は公式Originで404にする。この編集画面の入口は2026-09-16に専用ページへ
整理した。

同日に隔離配信の設定境界を修正した。実行管理Originの未設定時フォールバックを削除し、公式Originと
異なるhostnameを必須にした。実行管理CSPの`frame-ancestors`は正規化した公式Originから生成し、
許可Originと拒否Originの埋込みをChromiumで確認する。保存APIの頻度制限はBunの実接続元を使い、
信頼済みプロキシを明示した場合だけ検証済み`X-Forwarded-For`を使う。利用者入力の転送元情報は
直接信用せず、接続元が取得できない要求を共通`unknown`へ集約しない。

同日に共有保存の内部接続を実装した。`apps/web/server`のBunサーバーは組込みSQLiteへ単一JSXの
タイトル、説明、source、compilerVersion、限定公開の値をスナップショットとして保存し、保存ごとに
128ビットのIDを発行する。管理鍵はブラウザで256ビット乱数から生成し、SQLiteにはSHA-256ハッシュだけを
残す。同じrequestId・管理鍵・入力の再送は同じIDを返し、入力競合は409、削除後の再送は410、無権限の
削除は404とする。本文、UTF-8文字数、公式Origin、JSON形式、頻度制限、SQLite停止を検査し、保存・読取り・
削除・OGPメタデータ生成はsourceをコンパイルまたは実行しない。実行画面へ管理鍵を渡さず、通信断時は
公式画面の下書きと管理鍵をブラウザ保存領域へ残して再送と書き出しへ接続した。共有ページのSSRは内部実装済み
で、保存APIは実運用の設定を確定するまで公開入口から分離する。

2026-09-14に保存済み共有ページのSSRを実装した。`PlaygroundPage.jsx`を運営側のSSR部品として
Vite+でビルドし、Bunサーバーは`/playground/:id`の要求ごとにSQLiteの表示許可値を一度だけ読み、
`render(input) -> { html, state }`の同じ入力をhead・本文・hydrate stateへ渡す。末尾slashの308、
不存在・削除済みIDの404、保存先停止の503と`no-store`・`noindex`・`no-referrer`を実装した。タイトル、
説明、source全文はHTML文脈と埋込みJSONでescapeし、管理鍵と投稿sourceの実行結果をサーバー表示へ
入れていない。共有ページの複製は公式画面の編集欄へ戻り、管理鍵削除は公式Originの保存画面から行う。
ローカルSQLiteのバックアップ復元後に削除記録を再適用する手順と自動試験も追加した。実運用の保存先、
配信先、公開済み復元機能は未確定・未検証である。

2026-09-15にPlayground開発入口の問題を修正した。公式サイト用と実行管理用のVite+には別々の
依存最適化`cacheDir`を渡し、同時更新時の`ENOTEMPTY`を防ぐ。`/playground`は編集画面へ内部転送し、
結果iframeが読むIrisout実行時処理だけにCORSを許可した。開発用入口は`irisout/runtime`の公開項目を
再公開し、Counter以外の一覧・条件分岐にも対応する。並行起動、Listの選択・実行完了、開発経路の
自動試験を確認した。公式画面を`localhost`で開いた場合は、Cookie境界を保つため正規の
`127.0.0.1`へ転送する。公式サイト単独の起動は`bun run dev site`を使う。
同日に公式側の開発サーバーへ保存APIを接続し、保存・同一要求の再送を確認した。開発保存値は再起動で消えるため、
永続共有はBunサーバーのSQLite経路を使う。実行管理Originへ保存APIは置かない。

2026-09-16に公式サイトとPlaygroundの入口を整理した。LPの`App.jsx`から編集欄と動作例を削除し、
`playground.html`を`/playground`専用の編集画面へ変更した。LPの導線と共有ページからの複製はこのURLへ接続し、
共有ページのhydrate用JavaScriptは`shared-playground.js`として分離した。公式サイトの`/`には
`data-playground-root`を出力しないことをブラウザー試験で確認した。

同日に公式ホームページの視覚層を再設計した。工程を軸にしたNarrative WorkflowとCobaltの設計値を採用し、
`App.jsx`はコンパイルの入力・解析・出力を示す構成へ変更した。疑似IDE枠、発光、グラデーションを削除し、
コマンドパレット、コピー操作、モバイルメニュー、画面内表示を残した。320・375・414・768・1280pxの
横幅、区画内リンク、検索、キーボード操作、コピー、初期HTMLのハイドレーション、本番ビルドを確認した。

同日にPlaygroundの視覚層を監査・修正した。未適用だった専用CSSを追加し、introと編集器を上から配置し、広い画面では
入力欄と実行結果を左右に、狭い画面では縦積みに切り替え、入力欄・実行結果・フッターの幅と余白を統一した。Monacoの
編集領域へ固定高と横幅制約を与え、コメント色と行番号色をAA（アクセシビリティのコントラスト基準）へ合わせた。
320〜1280pxの画面幅、コントラスト、タッチ領域、フォーカス移動、操作、実ブラウザーの隔離実行を確認した。

同日にPlaygroundの実行結果領域で、公式画面と実行管理iframeの状態表示が重複する不具合を修正した。利用者向けの
状態表示を公式画面へ一元化し、実行管理iframe内の状態文を非表示にした。実ブラウザー試験へ表示重複の回帰条件を
追加し、隔離実行、状態更新、結果操作が継続することを確認した。

同日に実行管理iframeの結果箱が実行結果を囲む枠として表示される不具合を修正した。親画面の実行領域だけを枠として
残し、管理側の結果箱と結果iframeの背景を透明にして結果を直接表示する。実ブラウザー試験へ枠と背景の表示を確認する条件を追加した。

## 検証

- `bun run check`: 書式、静的検査、TypeScriptとauthored JSXの型検査。
- `bun run test`: コンパイラ、実DOM、生成物、別アプリの統合試験。
- `bun run build`: 利用例の本番ビルド。
- `bun run build:packages`: `irisout`のJavaScriptと型定義を生成。
- `bun run pack:smoke`: 一時ディレクトリへ梱包物を導入して公開4入口を`skipLibCheck:false`で型検査し、
  本番ビルド、初期HTML、イベント生成、ソースマップ、workspace依存の不存在を確認。
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
- ファイル経路はディレクトリ単位の`page.jsx`だけを受け付け、入れ子layout、catch-all、任意の
  経路制約、先読み、状態保持、フォーム更新、APIの自動登録は対象外である。loaderは利用側が
  `irisout/hono`のpage経路へ登録し、HTML文書の外枠は利用側が組み立てる。
- `irisoutRoutes`の初回hydrateは、文書へ`data-irisout-route-state` scriptを埋め込んだ場合に
  stateを再利用する。scriptがない、route idがURLと異なる、または遷移取得・描画に失敗した場合は
  通常の文書遷移へ戻る。Honoの`prefix`とHono側のmount pathは利用側が対応させる。
- 実行時ソースマップはイベント処理、`use=`、`onMount`、`effect`の処理文を対象とする。
  DOM探索、一覧照合、自動生成した更新関数には一対一の元構文がないため対応しない。
- Playgroundは単一`.jsx`とブラウザーが提供する組込み機能だけを受け付け、任意のnpm依存と複数
  ファイルは対象外である。共有ページのSSR経路は内部実装済みだが、本番用の保存期間・バックアップ・
  送信元情報の運用値は未確定である。実行管理画面は保存APIを持たない別hostnameの配信元へ置き、
  Cookie Domainを共有しない。実行管理Originは本番設定で必須とし、実運用のCSP `frame-ancestors`、
  runtime資産のCORS、Workerを含む配信ヘッダーを環境ごとに固定する。
- PlaygroundのMonaco 0.56.0は、最小構成のエディターAPI上で標準のコードレンズ・入力候補・インレイヒントなどの
  寄与機能を初期化すると、開発時コンソールへ不足サービスの例外を出す。構文色分け、入力、保存、実行は継続
  できるが、これらの機能の一部は現在の監査対象外である。

対応範囲の詳細と拒否例は`docs/getting-started.md`、`docs/architecture.md`、
`openspec/specs/`を参照する。
