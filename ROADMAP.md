# irisout ロードマップ

更新日: 2026-09-14。方針と判断の根拠は[開発方針](./docs/project-direction.md)に記載する。
この文書は今後の作業と着手条件を扱う。実装状況は[STATUS.md](./STATUS.md)、完了した計画は
[旧ロードマップ](./docs/history/roadmap-through-2026-09-07.md)、設計判断は[ADR](./docs/adr/)を参照する。

## 現在地

R1からR4までを完了し、`irisout` 0.2.2を2026-09-12にnpmへ公開した。診断、利用例、
性能改善、梱包物による外部導入を確認済みである。作者以外の人間による手動試用は
実施していない。詳細は[実装状況](./STATUS.md)に記録する。

## 今後の作業

[yt-util移植計画](./docs/yt-util-migration-plan.md)に従い、irisout・Hono RPCを組み合わせる利用例を実際にドッグフーディングしながら検証する。次は、認証済みのテスト対象で埋め込み生成と書き出しの画面操作を確認する。利用中に再現した不足は小さな変更として直し、必要になった接続処理をフルスタック対応の検討材料にする。irisout本体の機能追加は、次のいずれかを確認した場合に着手する。

1. 再現可能な不具合
2. 既存の記法では表せない実際の利用例
3. 計測で確認した速度、転送量、メモリの問題
4. 導入手順、診断、対応範囲の説明不足
5. 依存関係または対応環境の変更

人間の協力者が得られた場合は、導入、部品分割、診断修正、イベント更新、破棄を確認し、
止まった箇所を再現例として記録する。協力者を前提に期限は設けない。

公式サイトのドキュメントはSSGを基本とする。第0段階で、文書8分類とCounter・List・SVGの
例、`docs/getting-started.md`の正本、対象版を固定した。共有Playgroundでは、指定したルート
部品の初期描画全体を要求ごとにSSRし、`render(input) -> { html, state }`でstateをhydrateへ
渡す。初期対応は入力、テキスト、属性、条件分岐、局所signalに限り、module共有状態と投稿
JSXのサーバー実行は拒否する。契約は[ADR-0052](./docs/adr/0052-request-ssr-root-entry.md)、
文書範囲は[ADR-0053](./docs/adr/0053-site-document-source-and-initial-scope.md)、共有境界は
[ADR-0054](./docs/adr/0054-playground-share-and-posted-code-boundary.md)に記録した。

第0段階は完了した。次は[文書SSG](./openspec/changes/site-docs-ssg/)を実装し、その後に
[ブラウザ用コンパイラ入口](./openspec/changes/browser-compiler-entry/)、
[隔離実行](./openspec/changes/playground-isolated-execution/)、
[SSR入口](./openspec/changes/irisout-ssr-entry/)を試作する。保存・削除は
[playground-save-share](./openspec/changes/playground-save-share/)、共有ページの公開は
[playground-ssr-publish](./openspec/changes/playground-ssr-publish/)で扱う。各段階の条件は
[公式サイトと共有Playgroundの計画](./docs/irisout-site-and-playground-plan.md)に記載する。

Suspense、Transition、Portal、部品単位の例外回復などの機能は
予定へ置かない。必要性を示す利用例と、既存記法またはブラウザ標準機能では不足する理由が
得られた場合に検討する。

## 変更時の確認

通常は`bun run check`、`bun run test`、`bun run build`、`bun run build:packages`、
`bun run pack:smoke`を実行する。DOMや非同期処理を変える場合は該当するブラウザ操作試験、
性能を変える場合は同一条件の比較測定を行う。仕様変更は`openspec/specs/`、設計判断は
`docs/adr/`、状態の変化は`STATUS.md`へ記録する。
