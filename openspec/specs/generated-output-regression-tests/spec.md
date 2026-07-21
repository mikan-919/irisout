# generated-output-regression-tests

## Purpose

生成コードの構造(スナップショット)とサイズ(手書き基準に対する予算)の
退行を、`bun run check-all` 相当の毎コミット検証に組み込んで検出する。
このスイートは観測専用であり、プロダクトコード(`src/**`)は変更しない。

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
- **WHEN** `src/codegen.ts` の変更により生成コードの形が変わる
- **THEN** 記録済みスナップショットとの比較が失敗し、テストスイートが
  赤くなる

### Requirement: コンパイルの決定論
テストスイートは、同一の入力ソースを2回 `compile()` した結果の `code` が
完全に一致することを検証しなければならない(SHALL)。

#### Scenario: 同一ソースの2回コンパイル
- **WHEN** 同一のフィクスチャソースを2回連続で `compile()` する
- **THEN** 1回目と2回目の `code` は文字列として完全に一致する

### Requirement: 手書き基準に対するサイズ予算
テストスイートは、`scripts/build.ts` が生成する `dist/app.js` のバイト
サイズを、手書き基準ファイル(コメント・空行を除いたバイト数)に対して
一定の予算係数以内に収まることを検証しなければならない(SHALL)。予算を
超えた場合、係数を黙って緩めてはならない(SHALL NOT)。

予算係数は 4x とする(2026-07-18 変更: hydration-marker-verification の
ランタイム検証コードが `dist/app.js` に同梱される固定費で 3x を超過した
ため。生成コード側の肥大化ではなくランタイム固定費の増加であり、係数を
締め直すのは M6 のスコープ)。

#### Scenario: サイズ予算内
- **WHEN** `examples/counter.jsx` をビルドした `dist/app.js` のサイズが
  手書き基準ファイルのサイズの4倍以内である
- **THEN** サイズ予算テストは成功し、実測比がテスト出力に表示される

#### Scenario: サイズ予算超過
- **WHEN** `dist/app.js` のサイズが手書き基準ファイルのサイズの4倍を
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
