# 初期化の制御フロー検証

`use`、`onMount`、`effect`の分岐返却と途中返却をコンパイルし、生成したアプリをChromiumで操作する。更新関数と後始末の選択、局所変数の閉包、書込み前の返却、`finally`と例外回収、keyによる所有、後始末だけが読む状態の依存分離を検証する。構造unitの後始末が補助関数を呼ぶ場合も、rootのDOM更新を行わないことを検査する。

リポジトリーの依存を導入した状態で実行する。

```sh
bun fixtures/lifecycle-control-flow/verify.mjs
```

Playwrightは`packages/bench`から解決する。ブラウザーの実行ファイルは`IRISOUT_CHROMIUM_PATH`、リポジトリーの場所は`IRISOUT_REPO_ROOT`で指定できる。localhostの待受けとChromiumの起動が必要になる。

結果は`/tmp/irisout-lifecycle-control-flow.json`、生成したソース・JavaScript・初期HTML・画像は`/tmp/irisout-lifecycle-control-flow/`へ保存する。`IRISOUT_LIFECYCLE_RESULT`と`IRISOUT_LIFECYCLE_ARTIFACTS`で保存先を変更できる。検査が一件でも失敗すれば終了コードは1になる。

受入テストは`packages/compiler/test/lifecycle-control-flow.test.ts`。こちらは返却形の違反とeffectからの書込み拒否も検証する。
