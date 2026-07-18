# no-wrapper-cross-verification

## ADDED Requirements

### Requirement: 全機能横断フィクスチャの no-wrapper 検証
テストスイートは、全マイルストーン機能(signal / derived / テキスト
マーカー / 静的属性 / inline・識別子参照ハンドラ / イベント引数 / リスト+
ネスト条件分岐 / 条件分岐+ネストリスト / `use=` アクション+返り値
クロージャ)を含むフィクスチャを `compile()` し、生成コードに
`signal(`・`derived(` の呼び出しが一切現れないことを検証しなければ
ならない(SHALL)。

#### Scenario: 生成コードにラッパー呼び出しが無い
- **WHEN** 全機能フィクスチャを `compile()` する
- **THEN** 生成 `code` は部分文字列 `signal(` と `derived(` を含まない

### Requirement: runtime import 面の検証
テストスイートは、生成コードの import 文が runtime からの
`mount`/`hydrate` のみ(1行)であることを検証しなければならない(SHALL)。
ビルド時専用シンボル(`signal`/`derived`/`registry`)は生成コードから参照
されてはならない。

#### Scenario: import は mount/hydrate のみ
- **WHEN** 全機能フィクスチャを `compile()` する
- **THEN** 生成 `code` の import 文はちょうど1つで、import する名前は
  `mount` と `hydrate` のみである

### Requirement: 全機能フィクスチャの実 DOM 動作検証
テストスイートは、全機能フィクスチャの生成モジュールを実 DOM(jsdom)へ
mount し、イベント駆動の更新(ハンドラ書き込み → derived 再計算 →
テキスト / リスト keyed diff / 条件分岐切り替え / action クロージャ
再実行)が横断的に動作することを検証しなければならない(SHALL)。

#### Scenario: イベント駆動更新の横断動作
- **WHEN** 全機能フィクスチャを mount し、ハンドラ経由で signal を書き込む
  イベントを発火する
- **THEN** 依存するテキストマーカー・リスト・条件分岐・action クロージャの
  すべてに更新が反映される
