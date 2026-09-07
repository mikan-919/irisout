# 別アプリからの導入例

このディレクトリは、`@irisout/vite-plugin`を別のViteアプリへ追加する例です。
リポジトリのworkspaceとして依存を解決します。

```bash
bun install
vp -C examples/consumer-app build
vp -C examples/consumer-app dev
```

`src/App.jsx`を`irisout({ entry: 'src/App.jsx', container: '#app' })`へ渡し、
`index.html`の`#app`へ初期HTMLを置きます。authored JSXの型検査では
`@irisout/compiler/jsx`を`tsconfig.json`の`types`へ指定します。

workspaceを使わない梱包物の導入検査は、リポジトリのルートで
`bun run pack:smoke`を実行します。これは一時ディレクトリへ`0.1.0`のtarballを導入し、
`bun install`と`vp build`、生成HTMLとJavaScriptを確認します。
