# 関数本体のブラウザー検査

現在のソースでJSXをコンパイルし、生成物をChromiumで操作する。8項目は同期補助関数の返り値、書込み後の返却、書込み前の返却とeffect、例外と表示更新、内部の関数宣言による監視、非同期補助関数、Promiseコールバックの返り値、部品破棄時の監視解除である。

```sh
bun install
IRISOUT_CHROMIUM_PATH=/path/to/chromium bun fixtures/handler-control-flow/verify.mjs
```

リポジトリの依存関係からPlaywrightを読み込む。Chromiumの場所を指定しなければ、この検証で使ったNixOSの実行ファイルを使用する。結果は`/tmp/irisout-handler-browser.json`、入力と生成コード、初期HTML、ブラウザー用の梱包物、操作後の画像は`/tmp/irisout-handler-browser-artifacts/`へ書く。全項目が成功し、未処理のブラウザー例外がない場合だけ終了コード0を返す。確認対象の例外はブラウザーのerrorイベントで捕捉し、元の例外との同一性を検査する。

`IRISOUT_HANDLER_BROWSER_RESULT`と`IRISOUT_HANDLER_BROWSER_ARTIFACTS`で出力先を変更できる。別の場所へスクリプトをコピーした場合は`IRISOUT_REPO_ROOT`でソースの位置を指定できる。配信は実行中のローカルサーバーだけを使い、検査後に停止する。

2026-10-08の結果は[記録](../../docs/reports/evidence/2026-10-08-handler-browser.json)にある。これは操作の検査であり、画像の比較や配置崩れの検査ではない。
