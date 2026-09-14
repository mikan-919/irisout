# irisoutホームページ

irisout自身のVite連携で生成するホームページです。`src/App.jsx`がauthored JSXの入口で、
`src/main.js`の`virtual:irisout-entry`が初期HTMLとhydrate用生成コードを読み込みます。

## 実行

リポジトリのルートで次を実行します。

```bash
bun install
bun run dev:web
```

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
接続する`docs/examples.json`を同じ入力から生成します。現在のトップ画面のデモはこの索引を
まだ読み込まず、Playgroundの接続は後続changeで行います。
