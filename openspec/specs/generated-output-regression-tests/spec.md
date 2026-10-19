# generated-output-regression-tests

## Purpose

生成コードの構造(スナップショット)とサイズ(手書き基準に対する予算)の
退行を、`bun run check` と `bun run test` による毎コミット検証に組み込んで
検出する。実装は`packages/compiler/test/golden.test.ts`にあり、観測専用で
プロダクトコード(`packages/compiler/src/**`)は変更しない。保存済みのブラウザー操作は
`bun run test:browser`と変更ごとのCIで再実行する。

## Requirements

### Requirement: 生成コードの構造スナップショット
テストスイートは、代表フィクスチャ(M1: signal+derived counter、M2:
onClick ハンドラ付き counter)を `compile()` した結果の `code` と
`initialHtml` をスナップショットとして固定しなければならない(SHALL)。
意図しない構造変化が発生した場合、スナップショット比較は失敗しなければ
ならない。

#### Scenario: M1 フィクスチャのスナップショット一致
- **WHEN** M1 フィクスチャ(signal+derived counter)を `compile()` する
- **THEN** `code` と `initialHtml` が記録済みスナップショットと一致する

#### Scenario: M2 フィクスチャのスナップショット一致
- **WHEN** M2 フィクスチャ(onClick ハンドラ付き counter)を `compile()`
  する
- **THEN** `code` が記録済みスナップショットと一致する

#### Scenario: 意図しない codegen 変更の検出
- **WHEN** `packages/compiler/src/codegen.ts` の変更により生成コードの形が変わる
- **THEN** 記録済みスナップショットとの比較が失敗し、テストスイートが
  赤くなる

### Requirement: コンパイルの決定論
テストスイートは、同一の入力ソースを2回 `compile()` した結果の `code` が
完全に一致することを検証しなければならない(SHALL)。

#### Scenario: 同一ソースの2回コンパイル
- **WHEN** 同一のフィクスチャソースを2回連続で `compile()` する
- **THEN** 1回目と2回目の `code` は文字列として完全に一致する

### Requirement: 手書き基準に対するサイズ予算
テストスイートは、`apps/demos/vite.config.ts`を使うVite+ buildが生成する
`dist/app.js`のバイトサイズを、手書き基準ファイル(コメント・空行を除いた
バイト数)に対して
一定の予算係数以内に収まることを検証しなければならない(SHALL)。予算を
超えた場合、係数を黙って緩めてはならない(SHALL NOT)。

予算係数は 5.5x とする。2026-09-04にADR-0018のcomponent instance factory
という意図した固定費で実測4.38xとなり、2026-09-05にADR-0022のexplicit
unmount/lifecycle固定費を含む実測5.33xとなったため更新した。

#### Scenario: サイズ予算内
- **WHEN** `apps/demos/counter.jsx` をVite+ buildした `dist/app.js` の
  サイズが`apps/demos/counter.handwritten.js`のサイズの5.5倍以内である
- **THEN** サイズ予算テストは成功し、実測比がテスト出力に表示される

#### Scenario: サイズ予算超過
- **WHEN** `dist/app.js` のサイズが手書き基準ファイルのサイズの5.5倍を
  超える
- **THEN** サイズ予算テストは失敗する(係数の自動緩和は行わない)

### Requirement: signal/derived ラッパー非混入の回帰チェック
テストスイートは、記録済みスナップショットの文字列に `signal(` および
`derived(` が含まれないことを検証しなければならない(SHALL)。これは
ADR-0006(生成コードから signal/derived ラッパーが消えるという決定)の
継続的な回帰チェックとする。

#### Scenario: スナップショットへのラッパー混入
- **WHEN** 生成コードのスナップショットが `signal(` または `derived(` を
  含む
- **THEN** このチェックは失敗する

### Requirement: 保存済み操作の継続検証
`bun run test:browser`は、保存済みのハンドラー、初期化・破棄、関数境界の検査器と、
梱包物を別ディレクトリへ導入した障害対応ボードのHTTP・画面検査器を直列実行しなければならない(SHALL)。
CIは同じコマンドをChromiumの実行ファイル指定とともに実行し、失敗時のJSON・ログ・画面画像を
成果物として保存しなければならない(SHALL)。

#### Scenario: 変更後の操作検査が成功する
- **WHEN** 開発者またはCIがChromiumを指定して`bun run test:browser`を実行する
- **THEN** ハンドラー8項目、初期化・破棄8項目、関数境界のmount/hydrateを検証する
- **AND** 公開物を構築・梱包し、隔離導入先で型検査と本番構築を行う
- **AND** 空きポートで起動した障害対応ボードの8項目を確認し、終了コード0で停止する

#### Scenario: 操作が不合格になる
- **WHEN** 既存検査器が不合格を報告する
- **THEN** 全体の終了コードは1となり、JSONとログを残す
- **AND** 起動したサーバーとブラウザーを停止し、一時導入先を削除する

#### Scenario: 名前付きの受信数を確認する
- **WHEN** 障害対応ボードがラベル付き出力または本文の受信数を表示する
- **THEN** 初期値0から1回のイベントによる1への変化を確認する
- **AND** 同じ文書で一覧と詳細を反復し、監視数0→1→0→1→0→1→0を確認する
- **AND** 保存した公開版の試行ソース、原lock、過去の観測結果は変更しない
