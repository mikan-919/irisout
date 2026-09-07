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

出力先は`app/web/dist/`です。ページ内のCounter、List、SVGは、同じコンパイル経路で生成した
操作確認用の表示です。導入手順はtarballを前提にしており、npmへの登録は行っていません。
