# dynamic-attribute-bindings Specification

## Purpose
JSXの式コンテナ属性を、初期HTMLへの安全な焼き込みと、signal/derivedの
依存更新に対するpropertyまたはattribute反映へ変換する。静的属性・
List/conditional factory・no-wrapper出力との境界をADR-0012に従って固定する。
## Requirements
### Requirement: 式コンテナ属性値の受理と初期焼き込み
コンパイラは、host 要素の JSX 属性値が `JSXExpressionContainer` である場合
(属性名が `JSXIdentifier` で、`key`/`use`/`on[A-Z]...` を除く)、それを
動的属性バインディングとして受理しなければならない(SHALL)。トップレベル
要素では、ビルド時実行で評価した初期値を属性文脈エスケープ(`&`/`"`)
付きで初期 HTML に焼き込む。

#### Scenario: 動的 class の初期焼き込み
- **WHEN** `<p class={done() ? 'completed' : 'open'}>` を含むソースを
  `compile()` する(`done` の初期値は false)
- **THEN** compile error にならず、`initialHtml` の該当要素は
  `class="open"` を含む

#### Scenario: 属性値のエスケープ
- **WHEN** 動的属性の初期値が `"` や `&` を含む文字列になる
- **THEN** `initialHtml` の属性値はエスケープされ、HTML 構文を破壊しない

### Requirement: attribute/property の固定表による更新反映
コンパイラは、動的属性の更新反映を ADR-0012 の固定表で使い分けなければ
ならない(SHALL): `checked` は boolean プロパティ代入(初期 HTML は
presence)、`value` は文字列プロパティ代入、それ以外は
`setAttribute(name, expr)`。依存 signal の `update_<name>()` が該当要素の
属性/プロパティを再設定する。

#### Scenario: checked のプロパティ反映
- **WHEN** `<input type="checkbox" checked={on()} onClick={...}>` を mount
  し、ハンドラで `on` を true に書き込む
- **THEN** 要素の `checked` **プロパティ**が true になる(初期 HTML では
  presence 属性として焼き込まれる)

#### Scenario: class の setAttribute 反映
- **WHEN** 動的 class を持つ要素の依存 signal をハンドラで書き込む
- **THEN** `update_<name>()` 後、要素の `class` 属性値が新しい式の値になる

### Requirement: 構造ユニット内の動的属性
構造ユニット(リストアイテム/条件分岐ブランチ)内の動的属性は、
テンプレート HTML へ焼き込まず、factory 内で設定しなければならない
(SHALL)。item スコープでは `update()` で再設定し、item 仮引数を参照する
属性値がアイテム差し替えに追随する。属性式が追跡対象の signal/derived を
参照する場合はテキストと同じく scope limit で拒否する(SHALL)。

#### Scenario: リストアイテムの checked/class がアイテム値に追随する
- **WHEN** `<li key={item.id} class={item.done ? 'completed' : ''}>` と
  `checked={item.done}` を持つリストを mount し、ハンドラで items 配列の
  該当要素の `done` を反転して書き込む
- **THEN** keyed reuse された同一 DOM 要素の class 属性と checked
  プロパティが新しい値に更新される

#### Scenario: ユニット内属性式の追跡 signal 参照は拒否
- **WHEN** リストアイテム内の属性式が追跡対象の signal を参照する
  (例 `class={mode() === item.id ? 'a' : ''}`)ソースを `compile()` する
- **THEN** `compile:` で始まり `(scope limit)` を含むエラーが throw される

### Requirement: 生成コードの no-wrapper 維持
動的属性バインディングの生成コードにも signal()/derived() ラッパーを
持ち込んではならない(SHALL NOT)。属性更新は `update_<name>()` 内の
プレーンな代入・`setAttribute` 呼び出しのみで構成する。

#### Scenario: 属性更新コードの形
- **WHEN** 動的属性を含むソースを `compile()` する
- **THEN** 生成 `code` に `signal(`/`derived(` は現れず、属性更新は
  `update_<name>()` 内の代入または `setAttribute` である
