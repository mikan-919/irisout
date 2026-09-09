# ADR-0043: パッケージ梱包物と外部導入の検査

## ステータス

**ADR-0047で単一公開パッケージへ置換**(2026-09-09)

## 背景

`@irisout/compiler`、`@irisout/runtime`、`@irisout/vite-plugin`は、これまで同じ
リポジトリのworkspace（複数パッケージを一つの開発環境で解決する仕組み）だけを
前提にしていた。公開入口、実行時JavaScript、型定義を別の導入先へ渡せるかは、
workspaceの依存解決では確認できない。

R4では、公開登録を直ちに行うのではなく、利用者へ渡す梱包物を作り、親リポジトリの
workspaceに依存しない別ディレクトリで導入と本番buildを確認する必要がある。

## 決定

- 三つのpackageを版`0.1.0`の非private packageとして扱う。公開登録先はまだ決めず、
  `bun pm pack`で作るtarball（packageを一つにまとめたファイル）を当面の配布単位とする。
- `bun run build:packages`で、公開入口のJavaScriptと型定義を`packages/*/dist`へ生成する。
  `dist`は生成物のためGit管理には含めない。workspaceのインストール後にも生成できるよう、
  ルートの`prepare`から同じ処理を呼び出す。
- compilerの公開入口は`@irisout/compiler`、`@irisout/compiler/state`、
  `@irisout/compiler/diagnostics`、`@irisout/compiler/jsx`とする。runtimeとVite連携は
  それぞれのpackageの主入口から使う。
- `bun run pack:smoke`を外部導入の機械検査とする。検査は一時ディレクトリへ三つの
  tarballを導入し、Vite build、初期HTML、生成JavaScript、workspace指定の不存在を確認する。
  検査用の`overrides`（依存先を一時tarballへ差し替える設定）はfixtureだけに置き、
  配布packageの依存指定には残さない。
- この検査は作者以外の開発者による操作試用、npm等への公開、開発時の編集反映を代替しない。
  それらはR4の残作業として扱う。

## 結果

外部の利用者が取得するファイルの範囲と、workspace依存が漏れていないことを自動で確認
できる。現時点の`pack:smoke`は、別ディレクトリで`bun install`と`vp build`を実行し、
生成されたbuttonと`addEventListener`を確認して成功する。実際の公開版番号、変更履歴、
対応ブラウザ、作者以外の試用結果は、同検査と手動試用を重ねてから決める。

注: buildはJSXを静的HTMLとDOM更新処理へ変換する工程、型定義はTypeScriptが入力を
検査するための宣言ファイルである。tarballだけでの検査は、親workspaceのソースを
直接参照していないことを確認する目的で行う。
