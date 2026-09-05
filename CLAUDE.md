USE `bun`
COMMENT in Japanese

The session directory contains a history of your previous actions; if necessary, use grep or a similar tool to narrow down your search.

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
