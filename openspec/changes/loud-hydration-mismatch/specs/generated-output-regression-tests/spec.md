# generated-output-regression-tests

## MODIFIED Requirements

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
