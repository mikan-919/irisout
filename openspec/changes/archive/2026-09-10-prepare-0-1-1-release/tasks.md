## 1. 梱包物の検査

- [x] 1.1 一時利用アプリの本番構築でソースマップを出力し、`bun run pack:smoke`で生成されたイベント処理が元の`src/App.jsx`の行へ戻ることを確認する
- [x] 1.2 tarballへ変更履歴を含め、`bun pm pack`の内容一覧でREADME、変更履歴、ライセンス、公開入口を確認する

## 2. 版と文書

- [x] 2.1 公開パッケージを0.1.1へ更新し、梱包物の`package.json`で版を確認する
- [x] 2.2 0.1.0以後の診断修正、利用文書、実行時ソースマップを変更履歴へ記録し、README、STATUS、ROADMAPの公開状態を0.1.1公開準備済みへ更新する

## 3. 完了確認

- [x] 3.1 `bun run check`、`bun run test`、`bun run build`、`bun run build:packages`、`bun run pack:smoke`を通す
- [x] 3.2 `bunx @fission-ai/openspec validate prepare-0-1-1-release --strict`を通し、変更を保管する
