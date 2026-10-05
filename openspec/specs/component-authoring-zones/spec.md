# component-authoring-zones

## Purpose

コンポーネントを「変数ゾーン(const)→ UIゾーン(`render()`)→ 動きゾーン
(function宣言)」の3構造で解釈する(ADR-0008)。UI宣言は値を返さない`render(<JSX>)`マーカーか`return <JSX>`で行う。
返却記法ではfunction宣言と`onMount()`、`effect()`を返却前へ置ける(ADR-0063)。
ゾーン配置違反は明示的な compile error で拒否する。

## Requirements

### Requirement: render()またはreturnによるUI宣言
コンパイラは、コンポーネントのUI宣言を、値を返さないマーカー呼び出し
`render(<JSX>)`または`return <JSX>`として解釈しなければならない(SHALL)。`render()` は
`signal()`/`derived()` と同列のビルド時に消える宣言イディオム(ADR-0006)で
あり、生成コードには残らない。単一のJSX要素を返す記法も同じ生成処理を使う。
UI宣言は各部品に一つだけ許可し、両記法の併用、JSX以外の返却、条件付きの早期返却を拒否しなければならない(SHALL)。

#### Scenario: render() でUIを宣言する
- **WHEN** authored コンポーネントが `render(<div>{count()}</div>)` のように
  単一のJSX要素を引数に持つ `render()` 呼び出し文を含む
- **THEN** コンパイラは compile error を出さずに完了し、その引数JSXから初期
  HTMLテンプレートとマーカーを生成する

#### Scenario: UI宣言を持たないコンポーネント
- **WHEN** authored コンポーネントに`render()`もJSXの返却もない
- **THEN** コンパイラは `compile:` で始まり `(scope limit)` を末尾に含む
  エラーを投げる

#### Scenario: JSXをreturnするコンポーネント
- **WHEN** authored コンポーネントが`return <div/>`でUIを宣言する
- **THEN** コンパイラはHTMLとDOM更新コードを生成する

#### Scenario: 返却前のハンドラとライフサイクル
- **WHEN** JSXを返す部品が返却前にハンドラのfunction宣言と`onMount()`、`effect()`を含む
- **THEN** ハンドラの参照とライフサイクル処理を生成する

#### Scenario: 到達しないライフサイクル
- **WHEN** JSXを返した後に`onMount()`または`effect()`を呼ぶ
- **THEN** コンパイラは`compile: ... (scope limit)`で拒否する

### Requirement: 識別子参照ハンドラの巻き上げfunction宣言への解決
コンパイラは、ハンドラ属性の値が識別子参照(`onClick={handleCountUp}`)である
場合、その参照を同名のfunction宣言へ解決し、`render()`記法では後方、返却記法では返却前または後方の宣言を扱い、
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
function宣言と`onMount()`、`effect()`とする。返却記法では返却前にもfunction宣言と
`onMount()`、`effect()`を許可し、返却後はfunction宣言だけを許可する。違反は黙って通さず `compile: ... (scope limit)` で
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
