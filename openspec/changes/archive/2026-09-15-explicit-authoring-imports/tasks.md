## 1. 公開契約

- [x] 1.1 `irisout`の公開入口へ`signal`、`derived`、`render`、lifecycle、contextの型とcompile-only関数を追加する
- [x] 1.2 `irisout/jsx`から記述APIの大域宣言を削除し、importなしを型エラーにする

## 2. コンパイラ

- [x] 2.1 source parserとmodule linkerでrootの名前付き記述API importを取り除く
- [x] 2.2 import別名を正規名へ戻し、default・namespace・未知の名前を拒否する
- [x] 2.3 生成物にroot記述API importが残らないことを試験する

## 3. 移行と検証

- [x] 3.1 利用例、Playground初期値、型検査用入力、公開文書を移行する
- [x] 3.2 `bun run check`、`bun run test`、`bun run build`、`bun run build:web`、`bun run pack:smoke`を確認する
