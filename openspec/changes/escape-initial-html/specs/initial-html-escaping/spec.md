# initial-html-escaping

## ADDED Requirements

### Requirement: 初期 HTML への式値焼き込みは HTML エスケープされる
コンパイラは、ビルド時実行で初期 HTML に焼き込むテキストマーカーの式値に
対し、テキストノード文脈の HTML エスケープ(`&` → `&amp;`、`<` → `&lt;`)
を適用しなければならない(SHALL)。signal/derived の初期値に HTML 特殊文字
を含む文字列が入っても、`initialHtml` にマークアップとして解釈される形で
現れてはならない。

#### Scenario: HTML 文字列を初期値に持つ signal
- **WHEN** `signal("<img src=x onerror=alert(1)>")` を参照するテキスト式を
  含むソースを `compile()` する
- **THEN** `initialHtml` の該当テキストは
  `&lt;img src=x onerror=alert(1)&gt;` 相当(少なくとも `<` が `&lt;`)に
  エスケープされ、`<img` タグとして出現しない

#### Scenario: アンパサンドを含む初期値
- **WHEN** `signal("a & b")` を参照するテキスト式を含むソースを
  `compile()` する
- **THEN** `initialHtml` の該当テキストは `a &amp; b` になる

### Requirement: 初期表示と実行時更新の表示同一性
初期 HTML を DOM にパースした結果のテキスト内容は、同じ状態値で
`update_*()` が `textContent` に設定する文字列と一致しなければならない
(SHALL)。

#### Scenario: 特殊文字値のハイドレーション整合
- **WHEN** HTML 特殊文字を含む初期値のモジュールを `mountComponent()` し、
  状態を変えずに `update_*()` を呼ぶ
- **THEN** マーカー要素の `textContent` は update 前後で一致する

### Requirement: 生成モジュールにエスケープ機構を持ち込まない
エスケープはビルド時実行の中でのみ行い、生成される出力コード
(`update_*` の `textContent` 代入)にはエスケープ呼び出しを追加しては
ならない(SHALL NOT)(ADR-0004: 出力が膨らむ方向の変換を避ける)。

#### Scenario: 出力コードは不変
- **WHEN** HTML 特殊文字を含まない既存フィクスチャを `compile()` する
- **THEN** 生成 `code` と `initialHtml` は本変更前と同一である(golden
  スナップショット不変)
