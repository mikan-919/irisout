# ADR-0016: Vite+ツールチェーンとworkspace分割

## ステータス

**決定済み・実装済み**(2026-09-04)。

## コンテキスト

従来はBun test、Bun.build、Biome、TypeScript、Viteが個別に存在し、compiler、
runtime、examples、benchmarkもルート直下へ混在していた。最小ランタイムを機能単位で
発展させるには、公開境界と開発ツールの責務を先に明確にする必要がある。

## 決定

ルートをBun workspaceとし、次の4 workspaceへ分割する。

- `packages/compiler`: compiler本体、codegen、compilerテスト
- `packages/runtime`: 生成コードが必要時にimportする最小ランタイム
- `packages/bench`: jsdom/実ブラウザbenchmark
- `apps/examples`: authored JSX、比較fixture、Viteによるdev/build対象

開発コマンドはVite+へ統合する。formatはOxfmt、lint/typecheckはOxlintのtype-aware
経路、testはVite+ Test、example buildはViteを使用する。設定はルートの
`vite.config.ts`に集約する。Bunはpackage managerとして維持するが、テストAPIや
bundler APIとしては使用しない。

compilerの生成コードは相対ファイル位置ではなく`@irisout/runtime`をimportする。
runtimeはcompilerの型へ依存せず、workspace依存グラフを一方向に保つ。

`apps/examples/vite.config.ts`はauthored JSXをcompileする小さなVite pluginを持ち、
初期HTMLを`transformIndexHtml`で注入し、hydrate専用コードをvirtual moduleとして
bundleする。

## 結果

- package境界と生成コードのruntime境界が一致する。
- List以外のruntime helperを追加してもcompiler/runtimeを独立して検証できる。
- rootから`vp check`、`vp test --run`、`vp build`を実行できる。
- archivedな`legacy/`と生成済み`dist/`は静的検査対象外とする。
