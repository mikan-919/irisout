# component-authoring-zones

## ADDED Requirements

### Requirement: render() マーカーによるUI宣言
コンパイラは、コンポーネントのUI宣言を、値を返さないマーカー呼び出し
`render(<JSX>)` として解釈しなければならない(SHALL)。`render()` は
`signal()`/`derived()` と同列のビルド時に消える宣言イディオム(ADR-0006)で
あり、生成コードには残らない。コンポーネントはJSXを `return` しない。

#### Scenario: render() でUIを宣言する
- **WHEN** authored コンポーネントが `render(<div>{count()}</div>)` のように
  単一のJSX要素を引数に持つ `render()` 呼び出し文を含む
- **THEN** コンパイラは compile error を出さずに完了し、その引数JSXから初期
  HTMLテンプレートとマーカーを生成する

#### Scenario: render() を持たないコンポーネント
- **WHEN** authored コンポーネントに `render()` 呼び出しが1つも無い
- **THEN** コンパイラは `compile:` で始まり `(scope limit)` を末尾に含む
  エラーを投げる

#### Scenario: JSX を return するコンポーネントの拒否
- **WHEN** authored コンポーネントが `return <div/>` のようにJSXを返す
- **THEN** コンパイラは `compile:` で始まり `(scope limit)` を末尾に含む
  エラーを投げ、生成を継続しない

### Requirement: 識別子参照ハンドラの巻き上げfunction宣言への解決
コンパイラは、ハンドラ属性の値が識別子参照(`onClick={handleCountUp}`)である
場合、その参照を `render()` 文より後ろに置かれた同名のfunction宣言へ解決し、
その本体をハンドラ本体として配線しなければならない(SHALL)。参照先
function宣言の本体は単一の式文(`ExpressionStatement`)に限る。

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

#### Scenario: 参照先 function 宣言の本体が複数文の場合の拒否
- **WHEN** 参照先の function 宣言の本体が2つ以上の文を含む、または式文以外の
  文を含む
- **THEN** コンパイラは `compile:` で始まり `(scope limit)` を末尾に含む
  エラーを投げる(複数文ハンドラは ADR-0009 に分離)

### Requirement: inline arrow ハンドラの継続許可
コンパイラは、UIゾーン内のハンドラ属性に書かれた inline arrow
(`onClick={() => ...}`)を、この変更の後も引き続き受理しなければならない
(SHALL)。UIゾーンの内側は「UI宣言以降」であり配置規則に違反しない
(ADR-0008)。

#### Scenario: inline arrow ハンドラ
- **WHEN** authored コンポーネントが `render()` 内で
  `<button onClick={() => count(count() + 1)}>` を持つ
- **THEN** コンパイラは compile error を出さずに完了し、生成コードは
  `onClick` に対応するイベントリスナー配線を含む

### Requirement: ゾーン配置規則の強制
コンパイラは、コンポーネント本体の文をゾーンごとに検証し、配置違反を
compile error で拒否しなければならない(SHALL)。`render()` より前に許されるのは
`signal()`/`derived()` の const 宣言のみ、`render()` より後ろに許されるのは
function 宣言のみとする。違反は黙って通さず `compile: ... (scope limit)` で
throw する。

#### Scenario: 変数ゾーンに function 宣言を置く
- **WHEN** authored コンポーネントが `render()` より前に function 宣言を置く
- **THEN** コンパイラは `compile:` で始まり `(scope limit)` を末尾に含む
  エラーを投げる

#### Scenario: 動きゾーンに const 宣言を置く
- **WHEN** authored コンポーネントが `render()` より後ろに
  `const x = signal(0)` のような const 宣言を置く
- **THEN** コンパイラは `compile:` で始まり `(scope limit)` を末尾に含む
  エラーを投げる

#### Scenario: 正しいゾーン順序
- **WHEN** authored コンポーネントが「const 宣言(signal/derived)→
  `render()` → function 宣言」の順で書かれている
- **THEN** コンパイラは配置に関する compile error を出さずに完了する
