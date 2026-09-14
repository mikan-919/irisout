## 1. 入口と依存

- [ ] 1.1 単一`.jsx`文字列を受け取るブラウザ用入口を追加し、ファイルパスなしで型検査できることを確認する
- [ ] 1.2 Nodeのファイル機能とmodule linkerがブラウザ生成物へ入らないことを依存一覧で確認する
- [ ] 1.3 `irisout` tarballから新入口を解決でき、`irisout/vite`と既存入口が変わらないことを確認する

## 2. 対応範囲と診断

- [ ] 2.1 単一ファイルと同一ファイル部品を変換し、公式例のHTML・生成コード・診断を`compile()`と比較する
- [ ] 2.2 外部module、静的・動的import、外部資源を明示的なscope limit診断で拒否することを確認する

## 3. 検証

- [ ] 3.1 ブラウザ相当のWorkerで変換と結果取得を実行し、Node参照がないことを確認する
- [ ] 3.2 `bun run check`、`bun run test`、`bun run build:packages`、`bun run pack:smoke`とOpenSpec検証が成功することを確認する
