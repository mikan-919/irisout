# 別アプリからの導入例

このディレクトリは、`irisout`を別のViteアプリへ追加する例です。
リポジトリのworkspaceとして依存を解決します。

```bash
bun install
vp -C examples/consumer-app build
vp -C examples/consumer-app dev
```

`src/App.jsx`を`irisout({ entry: 'src/App.jsx', container: '#app' })`へ渡し、
`index.html`の`#app`へ初期HTMLを置きます。authored JSXの型検査では
`irisout/jsx`を`tsconfig.json`の`types`へ指定します。

workspaceを使わない梱包物の導入検査は、リポジトリのルートで
`bun run pack:smoke`を実行します。これは一時ディレクトリへ`irisout` 0.1.0のtarballを導入し、
`bun install`と`vp build`、生成HTMLとJavaScriptを確認します。

## R4手動試用

作者以外の開発者は、別の作業ディレクトリへこの例をコピーし、workspace指定を
tarballの絶対パスへ置き換えてから次を実行します。

```bash
bun install
vp build
vp dev
```

ブラウザで本文を編集し、本文表示と文字数が更新されることを確認します。その後、
`src/App.jsx`の表示文を変更して開発サーバーを再起動し、初期HTMLへ反映されることを
確認します。導入、型検査、編集反映、イベント更新、破棄で停止した箇所と、使用した
ブラウザ・Node・Bunの版を記録してください。自動の`pack:smoke`はこの手動試用の代用に
なりません。
