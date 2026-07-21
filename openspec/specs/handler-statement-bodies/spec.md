# handler-statement-bodies

## Purpose

ハンドラ本体(inline arrow のブロック本体、および識別子参照の解決先
function 宣言の本体)を単一の式文だけでなく、限定された4文種からなる
文列として受理する(ADR-0009)。第1引数によるイベントオブジェクトの
受け渡し、文中の signal 書き込みの代入への変換、および対応文種の外・
更新漏れになる形の明示拒否を扱う。

## Requirements

### Requirement: ハンドラのブロック本体(4文種)の受理
コンパイラは、ハンドラ本体(inline arrow のブロック本体、および識別子参照の
解決先 function 宣言の本体)として、`ExpressionStatement` /
`VariableDeclaration`(`const`・`let` のローカル宣言)/ `IfStatement` /
`ReturnStatement`(値を返さない裸の `return`)の4文種からなる文列を
受理しなければならない(SHALL)。`IfStatement` の consequent / alternate は
4文種のいずれか、または4文種のみからなる `BlockStatement` として再帰的に
検証する。

#### Scenario: ADR-0008 の決定例がコンパイルできる
- **WHEN** authored コンポーネントが `render()` の後ろに
  `function handleCountUp() { state(state() + 1) }` を宣言し、JSX から
  `onClick={handleCountUp}` で参照する
- **THEN** コンパイラは compile error を出さずに完了し、生成コードを
  実行するとクリックで `state` の表示が更新される

#### Scenario: 4文種すべてを含む本体がコンパイルできる
- **WHEN** ハンドラ本体が「裸の `return` を持つ `IfStatement`(ガード)→
  `const` ローカル宣言 → `IfStatement` → 追跡 signal への書き込み式文」の
  順で4文種すべてを含む(`examples/todomvc.jsx` の `handleInputKeyDown` 相当)
- **THEN** コンパイラは compile error を出さずに完了する

#### Scenario: inline arrow のブロック本体も同じ解析を通る
- **WHEN** authored コンポーネントが
  `onClick={() => { const n = count() + 1; count(n) }}` のようにブロック本体の
  inline arrow ハンドラを持つ
- **THEN** コンパイラは compile error を出さずに完了し、生成コードを実行すると
  クリックで `count` の表示が更新される

### Requirement: イベント引数の authored 名での受け渡し
コンパイラは、ハンドラの第1仮引数(単純な識別子)を受理し、authored の
引数名をそのまま生成ラッパーの第1仮引数へ昇格しなければならない(SHALL)。
本体内でのその引数の参照(メンバーアクセス・代入を含む)は書き換えずに
出力する。分割代入の仮引数・第2引数以降は受理しない。

#### Scenario: イベントオブジェクトを参照するハンドラ
- **WHEN** ハンドラが `function h(e) { if (e.key !== 'Enter') return ... }` の
  ように第1引数 `e` を宣言して本体で参照する
- **THEN** コンパイラは compile error を出さずに完了し、生成コードを実行して
  対象要素にイベントを dispatch すると、リスナは実際のイベントオブジェクトを
  `e` として受け取る

#### Scenario: 引数名が追跡 signal 名と衝突しても引数が勝つ
- **WHEN** top-level に `const value = signal(0)` があり、ハンドラが
  `function h(value) { ... }` と同名の引数を宣言して本体で `value` を参照する
- **THEN** 本体内の `value` は引数として解決され、signal の読み書きとしては
  扱われない(出力名への書き換え・`update_*` 生成が起きない)

#### Scenario: 分割代入の仮引数の拒否
- **WHEN** ハンドラが `({ target }) => { ... }` のように分割代入の仮引数を持つ
- **THEN** コンパイラは `compile:` で始まり `(scope limit)` を末尾に含む
  エラーを投げる

### Requirement: 文中の signal 書き込みの検出と代入への変換
コンパイラは、ブロック本体中の追跡 signal への引数1個の呼び出し
(`todos(next)`)を書き込みとして検出し、生成コードでは代入
(`todos = next`)へ書き換えなければならない(SHALL)。書き込み検出は
静的過剰近似とする: 条件分岐の内側にある書き込みも、実行時の到達可能性に
関わらず「書き込みうる」ものとして、対応する root signal の `update_*()`
呼び出しをラッパー本体の末尾に生成する。ローカル変数宣言・引数による
シャドーイングは書き込み検出の対象外に落とす。

#### Scenario: 文中の書き込みが代入へ変換される
- **WHEN** ハンドラ本体の文中に `todos([...todos(), item])` のような追跡
  signal への書き込みがある
- **THEN** 生成コードには `todos = [...todos, item]` に相当する代入が含まれ、
  `todos(...)` の呼び出し形は残らない

#### Scenario: 条件分岐内の書き込みでも update が生成される
- **WHEN** 書き込みが `if (cond) { count(1) }` のように分岐の内側にのみある
- **THEN** 生成ラッパーの末尾に `update_count()` の呼び出しが含まれ、実行時に
  分岐が成立した場合は表示が更新される

#### Scenario: ローカル宣言が signal と取り違えられない
- **WHEN** ハンドラ本体が `const count = 99` のように追跡 signal と同名の
  ローカルを宣言して参照する
- **THEN** そのローカルへの参照は書き換えられず、`update_count()` の生成
  対象にもならない

### Requirement: 4文種の外と更新漏れになる形の明示拒否
コンパイラは、4文種の外の文(ループ・`try`/`catch`・`switch`・関数/クラス
宣言など)、`var` 宣言、値を返す `return <expr>`、およびソース順で追跡
signal への書き込みより後ろに現れる `return` を、`compile:` で始まり
`(scope limit)` を末尾に含む compile error で拒否しなければならない
(SHALL)。黙って握りつぶしてはならない。

#### Scenario: ループを含む本体の拒否
- **WHEN** ハンドラ本体が `for` / `while` などのループ文を含む
- **THEN** コンパイラは `compile:` で始まり `(scope limit)` を末尾に含む
  エラーを投げる

#### Scenario: var 宣言の拒否
- **WHEN** ハンドラ本体が `var x = 1` を含む
- **THEN** コンパイラは `compile:` で始まり `(scope limit)` を末尾に含む
  エラーを投げる

#### Scenario: 値を返す return の拒否
- **WHEN** ハンドラ本体が `return false` のように値を返す `return` を含む
- **THEN** コンパイラは `compile:` で始まり `(scope limit)` を末尾に含む
  エラーを投げる

#### Scenario: 書き込みの後ろにある return の拒否
- **WHEN** ハンドラ本体がソース順で `count(1)` の後ろに `return`(分岐内を
  含む)を持つ
- **THEN** コンパイラは `compile:` で始まり `(scope limit)` を末尾に含む
  エラーを投げる(末尾 `update_*()` の取りこぼしを黙って通さない)
