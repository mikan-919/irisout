# ADR-0035: ヒートマップのWorker解析と連続入力

## ステータス

決定済み・実装済み(2026-09-06)

## コンテキスト

WebAssemblyを使う日本語解析を入力イベントのhandlerへ置くと、本文が長くなるほど画面の
更新と操作が解析完了まで待たされる。日本語入力では文字確定前にも`input`が発生するため、
そのたびに解析要求を送ると不要な処理が増える。連続入力では要求の完了順が入力順と異なる
場合に、古い結果が新しい表示を上書きする可能性がある。

## 決定

- `apps/examples/heatmap.worker.js`をWorkerの実行入口とし、Worker内でSuzumeとWebAssembly
  解析器を生成する。用語辞書はURLから画面側で取得し、初期化要求でWorkerへ渡す。
- 本文解析要求へ単調増加する`requestId`を付ける。画面側は最新の要求番号と一致する結果だけを
  `tokenCount`と状態表示へ反映する。解析例外とWorkerの`error`は失敗表示へ接続する。
- `compositionstart`から`compositionend`までは解析要求を送らず、確定後に一度送る。
  通常の`input`では処理中表示へ変更して要求を送る。
- root `onMount()`でWorker、イベント購読、辞書取得を開始し、cleanupで購読解除、破棄要求、
  `terminate()`を行う。状態更新は既存の非同期callback解析へ渡し、汎用の非同期実行基盤は
  追加しない。
- 各段落へ指標値を文字で表示し、`aria-live`の状態表示と`aria-selected`を用意する。段落の
  `ArrowUp`/`ArrowLeft`、`ArrowDown`/`ArrowRight`で選択を移動する。
- 代表アプリの測定範囲を300段落・25,000文字までとする。最大文章で入力から表示1,000ms、
  表示更新の差分100ms、ページ側JavaScriptヒープ増分32MiB、キーボード応答16msを完了基準に
  する。ページ側ヒープはWorkerとDOMのnative memoryを含まない。

## 結果

Workerへの分離後、300段落・24,790文字の入力でWorker内解析829.8ms、入力から表示850.8ms、
表示更新の差分21.0msだった。同じ条件のキーボード移動は0.4msで、解析待機中も操作処理を
分離できた。古い要求番号の結果、Worker失敗、画面破棄、文字確定前の入力を回帰試験で確認した。

段落数3、30、100、300の時間、ページ側JavaScriptヒープを
`packages/bench/heatmap.results.md`へ記録した。300段落・25,000文字を超える文章は測定の
保証範囲外とし、全段落表示が問題になるまでは表示範囲の限定を追加しない。

## 検証

- `packages/compiler/test/heatmap.test.ts`でWorker要求、要求番号、composition、失敗、cleanup、
  キーボード移動、指標文字列を確認した。
- `packages/bench/heatmap.playwright.ts`を実Chromiumで実行し、実Worker、WebAssembly、入力、
  日本語入力、段落移動、性能値を確認した。
- `bun run check`、`bun run test`、`bun run build`、`bun run bench:heatmap`を実行した。
