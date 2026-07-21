# compile-error-coverage

## ADDED Requirements

### Requirement: 分割代入宣言子の明示拒否
コンパイラは、変数ゾーンの `signal()`/`derived()` 宣言の宣言子が単純な
`Identifier` でない場合(配列/オブジェクト分割代入等)、`compile:` で始まり
`(scope limit)` を含むエラーで拒否しなければならない(SHALL)。生の
`ReferenceError` を露出してはならない。

#### Scenario: 配列分割代入の signal 宣言
- **WHEN** `const [a] = signal(0)` を含むコンポーネントを `compile()` する
- **THEN** `compile:` で始まり `(scope limit)` を含むエラーが throw される

### Requirement: コンポーネント外トップレベル文の明示拒否
コンパイラは、Program 直下の文のうち関数宣言(`export` 付きを含む)以外
(`const`/`let` 宣言、import、副作用式等)を、`compile:` で始まり
`(scope limit)` を含むエラーで拒否しなければならない(SHALL)。黙って
無視してはならない。

#### Scenario: トップレベル const の参照
- **WHEN** コンポーネント外に `const TAX = 1.1` があるソースを
  `compile()` する
- **THEN** 生の `ReferenceError` ではなく、`compile:` で始まり
  `(scope limit)` を含むエラーが throw される

#### Scenario: 既存の正常系は不変
- **WHEN** トップレベルが関数宣言のみの既存フィクスチャ(counter /
  todomvc)を `compile()` する
- **THEN** 従来どおりコンパイルが成功する

### Requirement: ビルド時実行エラーのラップ
コンパイラは、ビルド時実行(計装済みスクリプトの実行)で発生した例外を
そのまま伝播させず、`compile:` で始まるメッセージのエラーに包んで throw
しなければならない(SHALL)。元の例外は `cause` として保持する。

#### Scenario: ビルド時実行中の未知の例外
- **WHEN** 構文検査を通過するがビルド時実行で throw するソースを
  `compile()` する
- **THEN** throw されるエラーのメッセージは `compile:` で始まり、元の
  例外が `cause` から辿れる
