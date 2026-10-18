# 公開版irisout 0.3.7 利用者試験B

結果: 実装→型検査→本番構築→自己検査を3回実施し、3回目で8条件の自己検査が成功した。独立操作役の採点は未確認。依存導入の失敗、待受制限、原因調査コマンドは実装回数と区別してlog.mdへ記録した。

依存: Bun 1.4.3、irisout 0.3.7、vite-plus 0.3.0、TypeScript 5.9.3、Hono 4.13.13。npm公開版をbun installし、bun.lockを保存。許可されたpublic-docs-v2とbrief、依存のpackage.json・型宣言・診断だけを参照した。Playwrightは指定されたpackages/benchの依存を道具として使用。

実行: このディレクトリで `bun run typecheck`、`bun run build`、`DOGFOOD_PORT=4317 bun run serve`。本番生成物はdistから配信する。起動時には文書の説明どおり元のJSXと依存も必要。`DOGFOOD_PORT=4317 bun run selfcheck` が自己検査。初期状態はサーバープロセス再起動で復元する。自己検査用ブラウザーは保存領域を残さず終了する。

| 検査回 | 型検査 | 本番構築 | 自己検査                        |
| ------ | ------ | -------- | ------------------------------- |
| 1      | 成功   | 成功     | 一覧SSR成功、詳細SSRが500で停止 |
| 2      | 成功   | 失敗     | 実行せず                        |
| 3      | 成功   | 成功     | 8条件成功、ブラウザー例外なし   |

自己検査の確認内容:

1. JavaScriptなしのHTTP本文に一覧3件と詳細の件名がある。詳細不明IDは404。共有Layoutを相対importしloaderで値を渡す。
2. 一覧APIと解決APIをHonoへ接続。更新した結果を一覧・再読み込みへ反映。
3. API実測は決済605ms、通知31ms。決済入力直後に通知を入力し800ms後も通知だけを表示。
4. 失敗APIが503。画面に検索失敗を表示し、通知入力でエラーが消えて復帰。
5. 詳細リンクと戻るリンクによる遷移。windowへ設定した識別値が保持され、文書再読み込みがないことを確認。解決ボタンで解決済みを表示。
6. i1とi2に別の作業メモを保存。i2初回は空、i1への再遷移・再読み込みでi1のメモを復元。localStorage参照はイベントとonMountの内部。
7. 「監視中」段落のuseでincident-pingを登録し、同じ関数をdestroyで解除。受信数0→1を確認。登録数を事前スクリプトで観測し、詳細1・一覧0を3周、各周1イベント1更新を確認。
8. 決済検索中に通知詳細へ移り、800ms後も通知詳細とメモが存在し一覧項目がない。検索応答の反映は「要求番号一致かつ一覧の生存中」に限定。

キー付き一覧は`<li key={item.id}>`で実装した。ブラウザー自己検査では一覧の絞り込みと更新を確認したが、DOMの同一性自体の観測は行っていない。

役立った説明:

- authoring-state.md: 「部品が生きている間に保持する要求番号や生存状態は、表示に直接使わない値も`signal`で宣言する。」表示に使わない値も状態宣言へ置く判断ができた。
- events-and-actions.md: 「公開版では内部の監視関数に`const`のアロー関数を使う。」公開版と未公開版の差を回避できた。
- hono-file-routing.md: 「静的配信を外側のHonoアプリへ先に登録することで、ページルーターの未検出処理に渡る前に生成物を返す。」本番配信を構築できた。
- hono-file-routing.md: 「この構築で`dist/`へ出るのはブラウザー用生成物である。」Bun起動時に元のJSXも残す判断ができた。
- diagnostics-and-limits.md: 「要求単位SSRではサーバーでイベント、ライフサイクル、`use`を実行しない。」SSR中のブラウザーAPI参照を避けられた。

問題の区別:

- 本体不具合: Layoutのprops名titleとページのsignal名titleが一致すると、子の`title()`が`title()()`へ変換された。SSR詳細はHTTP 500。`bun repro/check.mjs`で独立した2つのJSXから再現し、`TypeError: title() is not a function`を記録した。文書の「propsを分割代入で受け取り」「相対importを…たどる」という範囲の記述だが、同名禁止の説明はない。回避としてページの状態名をsubjectへ変更。これは生成物からの推測であり文書から導いた規則ではない。
- アプリ変更による失敗／文書不足: HonoのonErrorを子ルーターへ追加してSSRエラーを調べようとしたが、次の構築で`compile: irisoutHono found no createFileRouter routes (scope limit)`になった。文書は「Honoへ登録された経路をSSOTとして読み」と述べるが、標準のonError追加と経路の認識の関係は説明されていない。診断追加を取り除いて回復。メタ情報が失われたと推測するが、実装を読んでいないため原因は未確定。
- 文書不足: SSRは500本文だけを返し、Honoへ追加したonErrorにも詳細が出なかった。公開compileProjectのssrCodeと型宣言から診断した。エラー調査の手順があると原因に到達しやすい。
- 環境制約: bun installのDNSResolveFailed、Bun.serveのlisten EPERM、自己検査HTTPのEPERM。該当するコマンドだけrequire_escalatedで実行し成功した。これらをirisoutの不具合に含めない。
- アプリ設計上の推測: Promise then/catch、入力の要求番号、activeの解除、localStorageのキー構造は文書のAPIとJavaScriptの知識を組み合わせた。通信の中止は行わず、古い応答の採用を防いだ。

資料: log.mdに各コマンド・出力と根拠の原文、repro/に最小再現、detail-generated-ssr.mjsに失敗時の自作ページからの生成物、repro-detail-before.jsxに変更前のページを保存した。独立操作役には本番サーバーを初期状態で引き渡す。
