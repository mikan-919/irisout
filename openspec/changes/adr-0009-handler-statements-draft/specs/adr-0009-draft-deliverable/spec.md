## ADDED Requirements

### Requirement: ADR-0009 ドラフトの網羅性
`docs/adr/0009-handler-statements-and-event-object.md` は、ステータスを
「ドラフト(レビュー待ち)」として作成され、以下5つの設計質問すべてに
推奨案・根拠・代案を含まなければならない(SHALL): (1) イベント引数の
受け渡し方式、(2) ハンドラのブロック本体として最初に許す文種の最小集合、
(3) 条件分岐内の書き込み検出の意味論、(4) `analyzeHandlerExpr` の
文レベルへの拡張形、(5) ADR-0008 との接続。

#### Scenario: 5つの設計質問すべてに推奨案がある
- **WHEN** `docs/adr/0009-handler-statements-and-event-object.md` を読む
- **THEN** 5つの設計質問それぞれについて、推奨案・根拠・検討した代案が
  記載されている

#### Scenario: ステータスがドラフトである
- **WHEN** `docs/adr/0009-handler-statements-and-event-object.md` の
  ステータス欄を読む
- **THEN** 「ドラフト(レビュー待ち)」であり、既存の決定済み ADR
  (0001〜0008)と区別できる

### Requirement: スクラッチ実験結果の引用
ADR ドラフトは、ローカル変数の scope 解決・シャドーイング・早期 return 内
書き込み検出について実施したスクラッチ実験の結果を、根拠として文章と
最小コード片で引用しなければならない(SHALL)。実験そのもののコードは
リポジトリにコミットしない(SHALL NOT)。

#### Scenario: 実験結果が ADR に引用されている
- **WHEN** ADR ドラフトの根拠部分を読む
- **THEN** 3つの検証項目(ローカル変数の安全性・シャドーイング・早期
  return 内書き込み)それぞれについて、確認結果が最小コード片とともに
  引用されている

#### Scenario: スクラッチ実験がリポジトリに残らない
- **WHEN** この変更の完了後に `git status` を確認する
- **THEN** スクラッチ実験用のファイルは存在しない(`src/**`・`test/**` に
  差分がない)

### Requirement: ROADMAP.md の状態付け替え
`ROADMAP.md` のうち、本 ADR がカバーするハンドラ関連の未規定 API 項目
(`examples/todomvc.jsx` の `UNRESOLVED` 対応表)は、削除ではなく
「ADR-0009 ドラフトあり・レビュー待ち」を示す形へ更新されなければならない
(SHALL)。

#### Scenario: 該当項目が ADR-0009 参照に更新されている
- **WHEN** `ROADMAP.md` のハンドラ関連の未規定 API 項目を読む
- **THEN** 該当項目が ADR-0009 ドラフトの存在とレビュー待ちの状態を
  参照している
