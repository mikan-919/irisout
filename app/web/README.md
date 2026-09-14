# irisoutホームページ

irisout自身のVite連携で生成するホームページです。`src/App.jsx`がauthored JSXの入口で、
`src/main.js`の`virtual:irisout-entry`が初期HTMLとhydrate用生成コードを読み込みます。

## 実行

リポジトリのルートで次を実行します。

```bash
bun install
bun run dev:web
```

Playgroundの実行管理画面を公式サイトと別配信元で起動する場合は次を使います。

```bash
bun run dev:web:playground
```

公式サイトは`127.0.0.1:5173`、実行管理画面は`localhost:5174`で起動します。実行管理画面は
保存APIや管理鍵を持たず、親画面から受け取るのは単一JSX、コンパイラー版、実行番号だけです。
投稿JSXは実行ごとのWorkerで変換し、結果は`sandbox="allow-scripts"`のiframeへ表示します。
実運用では`VITE_IRISOUT_PLAYGROUND_CONTROLLER_ORIGIN`へ隔離配信元を指定し、
`bun run test:web:playground`でCSP、応答ヘッダー、Cookie境界、停止と再実行をChromiumで確認します。

本番生成物は次で作成します。

```bash
bun run typecheck:web
bun run build:web
```

`build:web`は先に`docs/getting-started.md`と登録済み公式例を検査し、`/docs`と
`/docs/:slug`の静的HTML、目次、前後リンク、検索索引を`app/web/public/docs`へ生成します。
この処理は本文をJSXへ複製せず、Markdown解析器とIrisoutコンパイラを文書のブラウザ向け出力へ
含めません。出力先は`app/web/dist/`です。

文書だけを検査する場合は次を実行します。

```bash
bun run site:check
bun run site:test
```

ページ内のCounter、List、SVGは、同じコンパイル経路で生成した操作確認用の表示です。
導入手順はnpm公開版を前提にしています。

公式例の入力は`content/examples/`で管理し、文書ビルドは表示用コードと後続のPlaygroundが
接続する`docs/examples.json`を同じ入力から生成します。トップ画面のPlaygroundはこの索引を
読み込み、公式例の選択とブラウザー内の変換を実行します。
