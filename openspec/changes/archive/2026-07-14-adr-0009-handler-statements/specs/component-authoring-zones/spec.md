# component-authoring-zones (delta)

## MODIFIED Requirements

### Requirement: 識別子参照ハンドラの巻き上げfunction宣言への解決
コンパイラは、ハンドラ属性の値が識別子参照(`onClick={handleCountUp}`)である
場合、その参照を `render()` 文より後ろに置かれた同名のfunction宣言へ解決し、
その本体をハンドラ本体として配線しなければならない(SHALL)。参照先
function宣言の本体は、単一の式文、または対応文種のみからなるブロック本体
(`handler-statement-bodies` が規定する4文種)を受理する。対応文種の外は
`handler-statement-bodies` の拒否要件に従い compile error とする。

#### Scenario: 後方 function 宣言を参照するハンドラ
- **WHEN** authored コンポーネントが `render()` 内で
  `<button onClick={inc}>` を持ち、`render()` の後ろに
  `function inc() { count(count() + 1) }` を宣言する
- **THEN** コンパイラは compile error を出さずに完了し、生成コードは
  `inc` の本体に対応するイベントリスナー配線(書き込み先 signal の
  `update_*` 呼び出し)を含む

#### Scenario: 参照先が変数ゾーンの arrow の場合の拒否
- **WHEN** authored コンポーネントが変数ゾーン(`render()` より前)で
  `const inc = () => count(count() + 1)` を宣言し、JSXから `onClick={inc}`
  で参照する
- **THEN** コンパイラは `compile:` で始まり `(scope limit)` を末尾に含む
  エラーを投げる(識別子参照の解決先は render より後ろの function 宣言に限る)

#### Scenario: 参照先 function 宣言の複数文本体の受理
- **WHEN** 参照先の function 宣言の本体が対応文種(式文 / `const`・`let` /
  `if` / 裸の `return`)のみからなる複数の文を含む
- **THEN** コンパイラは compile error を出さずに完了し、生成コードはその
  文列に対応するイベントリスナー配線を含む
