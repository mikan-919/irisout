# 公開版0.3.7で観測した2問題

試行Bを隔離先へコピーし、READMEの固定依存導入を済ませた場所から実行する。

```sh
bun repro/check.mjs
bun repro/on-error-routes.mjs
```

`check.mjs`は`Layout.jsx`と`page.jsx`をSSRへコンパイルし、生成物を隔離先の`repro/generated.mjs`へ保存して実行する。公開版0.3.7では`title()()`が出力され、`TypeError: title() is not a function`となるため終了コード1が期待値である。生成物は再生成できるため保存しない。

`on-error-routes.mjs`は、子ルーターの`onError`を追加しない場合と追加する場合を同じ公開APIで比較する。内部の経路認識の仕組みは読まず、受理・拒否と診断を出力する。[再実行の要約](../../../evidence/b/replay-summary.json)へ結果を保存する。現行ソースでの再現と内部原因の調査は、この公開版試行の対象外である。
