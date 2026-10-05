USE `bun`
COMMENT in Japanese

The session directory contains a history of your previous actions; if necessary, use grep or a similar tool to narrow down your search.

## jj の作業保存・変更確定・送信

- Gitリポジトリがjj管理下にない場合は、`jj git init --colocate`で初期化する。
- 初回は`bun run jj:install`で、このリポジトリに検査付きの別名を登録する。
- 作業途中とユーザーへ応答する前は`jj status`で作業コピーを保存する。この操作では検査を実行しない。
- 変更確定には`jj ci -m "<英語命令形の要約>"`または`jj finish -m "<英語命令形の要約>"`を使う。静的検査・型検査・試験を通してから、変更を確定して次の作業コピーを作成する。
- 送信には`jj push`を使う。送信対象は`--bookmark`などで指定する。
- 検査失敗時は原因を修正する。検査を回避する目的で`jj commit`、`jj describe`と`jj new`の組み合わせ、`jj git push`を直接使わない。jj本体はGitフックを実行しないため、これらの操作では検査が走らない。
- 検査対象は現在の作業コピー全体である。別の履歴を送信するときは、その変更を作業コピーに開いて検査する。詳細は`docs/jj-hooks.md`を参照する。

## ドキュメントの役割分担

- `CONCEPT.v3.md` — プロジェクトの目的と哲学。迷ったらここに立ち返る。
- `docs/architecture.md` — コンパイラの内部構造・パイプライン・設計変更の
  進め方。**コードを触る前に読むこと。**
- `docs/conventions.md` — コーディング規約(コメント・エラー書式・型・
  テストの書き方)。**コードを書く前に読むこと。**
- `STATUS.md` — 実装ステータス(現在地・マイルストーン進捗・既知の制約)。
  マイルストーンを完了させた、または計画外の制約・バグを発見したら、
  聞かれなくてもここを更新すること。
- `ROADMAP.md` — 前向きな計画(設計判断待ちの論点・次のアクション)のみ。
  ステータス情報を書き足さない。
- `docs/adr/` — 決定済みの設計判断(却下した案も含む)。
- `openspec/specs/` — 実装済み・実装対象の受入条件を置く正本。
- `openspec/changes/` — 仕様変更のproposal/design/tasks。CLIを使う場合は
  `bunx @fission-ai/openspec`を使い、完了したchangeは`archive/`へ移す。
