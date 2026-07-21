# static-host-attributes

## Purpose

JSX ホスト要素に書かれた静的な文字列属性・値なし真偽属性をコンパイルし、
生成される初期 HTML テンプレートへ反映する。spread 属性は明示的な
compile error で拒否する。動的(式コンテナ)属性値は ADR-0012 以降
`dynamic-attribute-bindings` capability が扱う。

## Requirements
### Requirement: 静的文字列属性のテンプレート反映
コンパイラは、host 要素の JSX 属性値が文字列リテラル(`StringLiteral`)である
場合、その属性をマーカーやハンドラ配線を発行せず、生成される初期 HTML
テンプレート文字列へ属性名・属性値としてそのまま反映しなければならない
(SHALL)。

#### Scenario: 単一の静的文字列属性
- **WHEN** authored JSX が `<button type="button">` のように文字列リテラル
  値を持つ host 属性を含む
- **THEN** コンパイラは compile error を出さずに完了し、生成される初期 HTML
  テンプレートの該当要素に `type="button"` を含む

#### Scenario: 複数の静的文字列属性
- **WHEN** authored JSX の1つの host 要素が複数の文字列リテラル属性
  (例 `<div class="todoapp" id="root">`)を持つ
- **THEN** 生成される初期 HTML テンプレートの該当要素は両方の属性を含む

#### Scenario: 属性値内の特殊文字のエスケープ
- **WHEN** 属性の文字列リテラル値が二重引用符やアンパサンド等 HTML 属性値の
  構文上エスケープが必要な文字を含む
- **THEN** コンパイラは生成される HTML テンプレート内でその属性値を
  安全にエスケープし、テンプレートの HTML 構文を破壊しない

### Requirement: 値なし真偽属性のテンプレート反映
コンパイラは、値を持たない JSX 属性(`disabled` のように `JSXAttribute.value`
が存在しない valueless attribute)を、生成される初期 HTML テンプレートへ
値なしの属性としてそのまま反映しなければならない(SHALL)。

#### Scenario: 値なしの真偽属性
- **WHEN** authored JSX が `<input disabled>` のように値を持たない host
  属性を含む
- **THEN** コンパイラは compile error を出さずに完了し、生成される初期 HTML
  テンプレートの該当要素に値なしの `disabled` 属性を含む

### Requirement: spread 属性の拒否の維持
コンパイラは、host 要素の `JSXSpreadAttribute`(`{...props}`)を、この変更の
前後を通じて compile error で拒否し続けなければならない(SHALL)。

#### Scenario: spread 属性
- **WHEN** authored JSX が `<div {...props}>` のように spread 属性を含む
- **THEN** コンパイラは `compile:` で始まり `(scope limit)` を末尾に含む
  エラーを投げる

### Requirement: ハンドラ属性との共存
コンパイラは、`on[A-Z]...` ハンドラ属性と静的属性(文字列リテラル・値なし
真偽属性)が同一の host 要素に混在する場合、両方を正しく処理しなければ
ならない(SHALL)。

#### Scenario: ハンドラ属性と静的属性の混在
- **WHEN** authored JSX が `<button type="button" onClick={() => count(count() + 1)}>`
  のように静的属性とハンドラ属性を同一要素に持つ
- **THEN** コンパイラは compile error を出さずに完了し、生成される初期 HTML
  テンプレートは `type="button"` を含み、かつ生成コードは `onClick` に
  対応するイベントリスナー配線を含む

