# ADR-0012: 動的属性バインディング(attribute/property の使い分け)

## ステータス

決定済み(change `dynamic-attribute-bindings`)

## コンテキスト

M4(静的host属性、ADR なし・change `m4-static-host-attributes`)は文字列
リテラル・値なし属性のみを受理し、式コンテナ値は scope limit で拒否して
きた。TodoMVC パリティの残穴 UNRESOLVED(02)/(03)(ROADMAP 参照)は
どちらも式コンテナ値の host 属性:

- (02) `class={todo.completed ? 'completed' : ''}` — 値が変わる文字列属性。
- (03) `checked={todo.completed}` — attribute として一度書くだけでは以後の
  変更が反映されず、DOM **プロパティ**として都度反映する必要がある。

handwritten 目標出力は `el.classList.toggle(...)` / `checkbox.checked = ...`
と書いており、「属性は setAttribute、状態系はプロパティ代入」を素で
使い分けている。

## 決定

### 1. 式コンテナ値の host 属性を「動的属性バインディング」として受理する

属性名は `JSXIdentifier` のみ(namespaced・spread は引き続き拒否)。
`key` / `use` / `on[A-Z]...` は既存の別分類のまま。

### 2. attribute / property の使い分けは固定表で行う

- **boolean プロパティ**(現時点で `checked` のみ): 初期 HTML へは
  presence(値なし属性)として焼き込み、更新は `el.checked = expr` の
  プロパティ代入。
- **文字列プロパティ**(現時点で `value` のみ): 初期 HTML へは属性として
  焼き込み、更新は `el.value = expr`。
- **それ以外すべて**: 初期 HTML へは属性として焼き込み、更新は
  `el.setAttribute(name, expr)`。

表は実需(TodoMVC パリティ)が要求する最小限に留める。`disabled` /
`selected` 等を動的に使う実需が出たら、この ADR に追記して表を広げる —
汎用の property 推論機構(React の DOM プロパティ表のような網羅)は
持ち込まない(ADR-0004: 出力が膨らむ方向を避ける)。

### 3. 初期値の焼き込みはトップレベルのみ、ユニット内は factory が設定する

- トップレベル要素: ビルド時実行テンプレートに属性文脈エスケープ
  (`__escAttr__`: `&`/`"`)付きで焼き込む(escape-initial-html と同じ
  注入方式)。
- 構造ユニット(リストアイテム/条件分岐ブランチ)内: テンプレートには
  焼かず、factory 内で設定する。item スコープでは update() で再設定し、
  item なしのブランチでは一度だけ設定する(テキストマーカーと同じ規則)。

### 4. 更新配線は既存のマーカー機構に相乗りする

トップレベルの動的属性は要素のマーカー id(text/handler と共有、なければ
新規発行)に紐づけ、依存 signal の `update_<name>()` から再設定する。
新しい実行時機構(属性用のディスパッチ等)は作らない。

### 5. ユニット内の追跡 signal 参照はテキストと同じ scope limit

アイテム内の属性式が追跡対象の signal/derived を参照する場合
(例 `class={editingId() === todo.id ? ... : ''}`)は scope limit で拒否
する。item フィールド参照のみ許す。UNRESOLVED(04)(アイテム内ローカル
状態)の解決とセットで将来緩める。

## 検討した代替案

- **classList.toggle への特化**(handwritten と同形): class 専用機構に
  なり、汎用の文字列属性(`title` 等)を別途作ることになる。
  `setAttribute('class', ...)` は意味的に同等で汎用。却下。
- **全属性をプロパティ代入に統一**: `class` は `className`、`for` は
  `htmlFor` 等の名前変換表が必要になり、SVG 属性で破綻する。却下。
- **attribute に統一**(property 表なし): (03) の checked が動かない
  (attribute は初期値でしかない)。却下。
