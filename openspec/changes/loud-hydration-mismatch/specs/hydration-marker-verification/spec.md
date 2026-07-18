# hydration-marker-verification

## ADDED Requirements

### Requirement: mount/hydrate 時のマーカー存在検証
ランタイムの `mount()`/`hydrate()` は、期待マーカー ID リストを受け取った
場合、収集結果に存在しない ID があれば、欠落 ID を列挙するメッセージの
エラーを throw しなければならない(SHALL)。黙って no-op になっては
ならない。

#### Scenario: 欠落マーカーのある DOM への hydrate
- **WHEN** 生成モジュールの `hydrateComponent()` を、期待マーカーの一部を
  欠く(改変済み初期 HTML の)コンテナに対して呼ぶ
- **THEN** 欠落したマーカー ID を含むメッセージのエラーが throw される

#### Scenario: 正常な DOM への mount/hydrate
- **WHEN** 焼き込み済み初期 HTML と一致するコンテナへ `mountComponent()` /
  `hydrateComponent()` を呼ぶ
- **THEN** エラーは throw されず、従来どおり動作する

### Requirement: 生成コードは期待マーカー ID を渡す
生成モジュールは、コンパイル時に確定したトップレベルマーカー ID
(テキスト/リスト/条件分岐/アクション/ハンドラのみのマーカー)の全リストを
`mount()`/`hydrate()` へ渡さなければならない(SHALL)。factory 内部の
ローカルマーカーは対象外とする。

#### Scenario: 期待 ID リストの網羅
- **WHEN** テキストマーカーとハンドラのみマーカーを含むソースを
  `compile()` する
- **THEN** 生成コードの mount/hydrate 呼び出しには両方のマーカー ID を含む
  リストが渡される

### Requirement: 検証引数の後方互換
`mount()`/`hydrate()` は期待 ID リストが渡されない場合、従来どおり検証
なしで動作しなければならない(SHALL)。

#### Scenario: ID リストなしの呼び出し
- **WHEN** `hydrate(container)` を ID リストなしで呼ぶ
- **THEN** 検証は行われず、マーカー収集結果のみが返る
