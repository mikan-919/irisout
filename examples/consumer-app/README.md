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
`@irisout/compiler/jsx`を`tsconfig.json`の`types`へ指定します。`src/App.jsx`では
`bind:value={text}`でtextareaと文字列signalを結んでいます。
