# 文書一覧

読みたい内容に合わせて、該当する文書を選んでください。公式サイトに掲載する利用者向け文書も、このディレクトリにあります。

## irisoutを使う

次の文書は、公式サイトの「ドキュメント」に掲載しています。掲載する文書と順番は [`apps/web/content/docs/manifest.json`](../apps/web/content/docs/manifest.json) で管理しています。

| 分類           | 文書                                                       | 内容                                   |
| -------------- | ---------------------------------------------------------- | -------------------------------------- |
| 導入           | [npm公開版から始める](./getting-started.md)                | 新しいアプリへの導入と初回ビルド       |
| 状態           | [状態と派生値](./authoring-state.md)                       | `signal`、`derived`、DOM更新           |
| イベント       | [イベントとuseアクション](./events-and-actions.md)         | イベント引数と要素に接続する処理       |
| 一覧           | [条件分岐とキー付き一覧](./conditionals-and-lists.md)      | 条件分岐、`map`、`key`                 |
| 部品           | [部品とファイル分割](./components-and-modules.md)          | props、children、相対import            |
| ライフサイクル | [ライフサイクルとコンテキスト](./lifecycle-and-context.md) | 初期化、更新、終了処理、値の共有       |
| API            | [APIリファレンス](./api-reference.md)                      | 公開入口と記述API                      |
| API            | [Honoとファイル経路](./hono-file-routing.md)               | `page.tsx`、loader、SSR、画面遷移      |
| 診断           | [診断と対応範囲](./diagnostics-and-limits.md)              | 診断の読み方と、現在対応していない機能 |

## irisout本体を開発する

| 文書                                 | 内容                                  |
| ------------------------------------ | ------------------------------------- |
| [アーキテクチャ](./architecture.md)  | コンパイラの処理と内部構造            |
| [コーディング規約](./conventions.md) | コードを書く際の決まりと検査方法      |
| [開発方針](./project-direction.md)   | 開発で優先することと、その理由        |
| [リリース](./releasing.md)           | 版の更新、検査、公開の手順            |
| [jjの検査](./jj-hooks.md)            | Jujutsuで変更を確定・送信する際の検査 |

実装状況は [`STATUS.md`](../STATUS.md)、今後の作業と着手条件は [`ROADMAP.md`](../ROADMAP.md) を確認してください。

## 仕様と設計の記録

| 場所                                        | 役割                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`CONCEPT.v3.md`](../CONCEPT.v3.md)         | プロジェクトの目的と設計の基本方針                                                            |
| [`docs/adr/`](./adr/)                       | 採用した設計と、採用しなかった案。現行ライセンスは[ADR-0064](./adr/0064-mit-license.md)に記録 |
| [`openspec/specs/`](../openspec/specs/)     | 実装する機能の受け入れ条件                                                                    |
| [`openspec/changes/`](../openspec/changes/) | 進行中の仕様変更と、完了した変更の記録                                                        |

## 計測結果

ベンチマークの結果は、測定コードと同じ場所にあります。

- [`packages/bench/`](../packages/bench/) — 測定結果、測定条件、実行コード
