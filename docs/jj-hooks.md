# jj の検査

このリポジトリで次を一度実行する。jj が未導入の Git 作業コピーでは、先に `jj git init --colocate` を実行する。

```sh
bun run jj:install
```

リポジトリ内の jj 設定に別名を登録する。Bun と依存パッケージが必要なため、`bun install` 後に使う。作業コピーを移動した場合は登録をやり直す。

```sh
jj ci -m "Add feature"
jj finish -m "Add feature"
jj push --bookmark main
```

`jj ci` と `jj finish` は、`bun run check`（書式・静的解析・型検査）と `bun run test` を通してから `jj commit` を実行する。全変更を対象とする場合、`jj commit` は説明の更新と次の作業コピーの作成を行う。`jj push` は同じ検査を通してから `jj git push` を実行する。引数は各コマンドへ渡し、検査に失敗したら確定・送信を中止する。自動修正は行わない。

検査対象は現在の作業コピー全体である。変更の一部だけを確定する場合や、現在の作業コピーとは異なる履歴を送信する場合、その履歴だけを取り出して検査する機能はない。送信する変更を作業コピーに開いて検査するか、公開前の CI の結果を確認する。

[jj は Git フックを実行しない](https://github.com/jj-vcs/jj/blob/main/docs/git-compatibility.md)。また、別名では組み込みコマンドを上書きできない。`jj commit`、`jj describe`、`jj new`、`jj git push` を直接実行すると、この検査は走らない。変更確定には `jj ci` または `jj finish`、送信には `jj push` を使う。`jj status` は検査せず作業コピーを保存する。Git のコミットには既存の Husky の `vp staged` を使う。
