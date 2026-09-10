# 別アプリからの導入例

このディレクトリは、`irisout`を別のVite+アプリへ追加する例です。リポジトリ内では
workspaceとして依存を解決する。同じ構成を空のディレクトリへ作る手順は
[`npm公開版から始める`](../../docs/getting-started.md)を参照する。

```bash
bun install
bun run typecheck:consumer
bun --cwd examples/consumer-app run build
bun --cwd examples/consumer-app run dev
```

`src/App.jsx`を`irisout({ entry: 'src/App.jsx', container: '#app' })`へ渡し、
`index.html`の`#app`へ初期HTMLを置きます。authored JSXの型検査では
`irisout/jsx`を`tsconfig.json`の`types`へ指定します。

workspaceを使わない検査には二種類ある。`bun run pack:smoke`は一時ディレクトリへ
ローカル梱包物を導入し、`bun run registry:smoke`はnpm公開版`irisout@0.1.1`を導入する。
どちらも型検査、本番ビルド、生成HTMLとJavaScriptを確認する。

## R4手動試用

作者以外の開発者は、[`npm公開版から始める`](../../docs/getting-started.md)に従って
別の作業ディレクトリへアプリを作り、次を実行する。

```bash
npm run typecheck
npm run build
npm run dev
```

ブラウザで本文を編集し、本文表示と文字数が更新されることを確認します。その後、
`src/App.jsx`の表示文を変更して開発サーバーを再起動し、初期HTMLへ反映されることを
確認します。導入、型検査、編集反映、イベント更新、破棄で停止した箇所と、使用した
ブラウザ、Node.js、npmまたはBunの版を記録する。自動の`pack:smoke`と
`registry:smoke`はこの手動試用の代用にはならない。

リストと条件分岐の内容は初期HTMLへ直接入らず、ブラウザの初期化時にコメントで示した
範囲へ挿入される。破棄を確認する場合は、`use=`が`destroy`を返す要素を条件分岐または
キー付きリストへ置き、分岐の切り替えまたは項目削除で`destroy`が一度呼ばれることを
確認する。コード例とルート部品全体の破棄に関する制約は
[`npm公開版から始める`](../../docs/getting-started.md#破棄を確認する)に記載する。
