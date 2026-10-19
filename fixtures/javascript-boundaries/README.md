# 関数値の対応境界

`bun fixtures/javascript-boundaries/reproduce.mjs`は4群の最小例をコンパイルし、生成物をjsdomで実行する。変更前後の結果は`docs/reports/evidence/2026-10-19-javascript-boundaries-{before,after}.json`にある。変更前は`06ea699`の`packages/compiler/src`と`packages/runtime/src`を`git archive`で別ディレクトリーへ展開し、その直下からこのリポジトリーの`node_modules`を参照させる。`IRISOUT_BASELINE_COMPILER`へ展開先の`packages/compiler/src/compiler.ts`の絶対パスを設定して同じ検査器を実行できる。保存先は`IRISOUT_BOUNDARY_RESULT`で変更する。

`bun fixtures/javascript-boundaries/verify.mjs`はChromiumでmountとhydrateの両方を検査する。const別名と引数経由の書込み、effectの読み取り依存、保存した更新・後始末関数、非同期完了後の反映、子の後始末から親の表示へ更新しないこと、関数名と引数数、一度だけの破棄を確認する。ブラウザーは`IRISOUT_CHROMIUM_PATH`、結果は`IRISOUT_BOUNDARY_BROWSER_RESULT`、生成物と画像の保存先は`IRISOUT_BOUNDARY_ARTIFACTS`で指定する。

拒否境界、宣言前参照、再代入、返却と例外の検証は`packages/compiler/test/javascript-boundaries.test.ts`にある。検査対象と残る制限は`docs/reports/2026-10-19-javascript-boundaries.md`を参照する。

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`は従来の`IRISOUT_CHROMIUM_PATH`より優先する。ほかの保存済み検査と合わせた`bun run test:browser`を変更ごとのCIで実行する。[再実行手順](../incident-dogfood/README.md)を参照する。

`verify-hono.mjs`は梱包物とHonoを導入した別ディレクトリーへコピーし、そこで`bun verify-hono.mjs`を実行する。Hono 4.0.0と4.13.13で二段の`onError`、接頭辞付きの経路、SSRの200応答、`hono/hono-base`の外部importを確認する。2026-10-19の操作検査は、指定のChromium 154が消えていたためChrome for Testing 153.0.8010.12を使った。ブラウザーの実行ファイルは前述の環境変数で指定できる。
