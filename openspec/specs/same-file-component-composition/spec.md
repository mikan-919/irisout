# same-file-component-composition

## Purpose

同一ファイル内で宣言された複数の関数を`<Component/>`形式のJSXタグで
組み合わせる合成(ADR-0014、ADR-0023、change `same-file-component-composition`)を
規定する。既存のrender-tree走査(`compileComponent`、M1〜M6)より前に
実行する独立した前処理パスが、コンポーネント参照をコンパイル時ASTインライン
化で展開する。呼び出し先コンポーネントはビルド時・実行時のいずれにおいても
「関数として呼ばれる」ことは一度もない。props識別子置換・名前衝突時の
コンポーネント名リネーム・構造ユニットへインライン化された変数ゾーン宣言の
ローカルsignal化・children/slotと再帰参照のscope limit拒否を含む。
複数ファイルにまたがる合成は対象外(実需が出るまで対応しない)。

## Requirements

### Requirement: 同一ファイル内コンポーネント参照のASTインライン化
コンパイラは、同一ファイル内で宣言された関数を参照する`<Component/>`形の
JSXタグを、既存のrender-tree走査(`compileComponent`)より前に実行する
独立した前処理パスで、呼び出し先コンポーネントの`render()`引数JSXの
クローンへ置き換えなければならない(SHALL)。この展開はコンパイル時のみ
行われ、呼び出し先コンポーネントが実行時に関数として呼ばれることは一度も
あってはならない(SHALL NOT)。

#### Scenario: トップレベルでの単純な子コンポーネント参照
- **WHEN** authoredコードが`TodoApp`内で`<Footer count={n} />`を参照し、
  `Footer`が同一ファイル内に`function Footer({ count }) { render(<span>{count}</span>) } `
  として宣言されている
- **THEN** コンパイラは`compile: component references ... are not
  supported yet (scope limit)`を出さずに完了し、生成コードは`Footer`の
  呼び出しを一切含まない

#### Scenario: 展開後の走査は既存のscope limitと整合する
- **WHEN** インライン化により展開されたJSXが、既存のrender-tree走査規則に
  違反する形になる
- **THEN** コンパイラは展開前ではなく展開後のASTに対して既存のscope
  limitエラーを出す(構造ユニットの静的兄弟との混在はコメントアンカーで
  受理し、深すぎるネストなどの未対応範囲だけを拒否する)

### Requirement: propsのコンパイル時識別子置換
コンパイラは、呼び出し先コンポーネントの分割代入パラメータ
(`function TodoItem({ todo, onToggle }) {...}`)で束縛された各識別子への
参照を、呼び出し箇所の対応する実引数式のクローンで置き換えなければならない
(SHALL)。置換は呼び出し先本体内の当該パラメータへのbinding解決に基づき
行い、同名のシャドーイングされたローカル変数を誤って置換してはならない
(SHALL NOT)。実行時のpropsオブジェクト/専用primitiveを新設してはならない
(SHALL NOT)。

#### Scenario: プロパティ参照が呼び出し元の式にそのまま乗る
- **WHEN** `<TodoItem todo={todo} onToggle={() => toggleTodo(todo.id)} />`が
  `.map((todo) => ...)`のアイテム位置で呼ばれ、`TodoItem`本体が
  `{todo.text}`・`onClick={onToggle}`を参照する
- **THEN** 展開後の`{todo.text}`・`onClick`はいずれも呼び出し元の対応する
  実引数式に置き換わる

#### Scenario: シャドーイングされた同名ローカル変数は置換されない
- **WHEN** `TodoItem`本体が`todo`パラメータとは別に、本体内で新たに
  `todo`という名前のローカル変数を宣言し直している
- **THEN** そのローカル変数への参照は呼び出し元の実引数式に置換されない

### Requirement: props参照を式の位置に依存せずコンパイル時に置換する
コンパイラは、propsの参照がJSX式コンテナやハンドラの式全体でなく、三項演算子・
二項演算子・メンバー式・呼び出し式などの内部にあっても、対応する実引数式の
クローンへ置換しなければならない(SHALL)。実引数の識別子名がprops名と異なる
場合、実引数が識別子でない場合、または元ソースに対応する位置を持たない
boolean shorthandをtrueへ置換する場合も、置換後の式を元ソースのstart/endから
切り出してはならない(SHALL NOT)。変換を含む式はASTからコード生成し、元の
props識別子を生成コードに残してはならない(SHALL)。

#### Scenario: 三項・二項・メンバー・呼び出し式の内部で置換される
- **WHEN** `<Foo item={items[index]} value={getValue()} />`が呼ばれ、`Foo`本体が
  `item.done ? value + 1 : 0`を参照する
- **THEN** コンパイラは`items[index].done ? getValue() + 1 : 0`相当の式を
  生成し、`item.done`・`value + 1`などの元props識別子を残さない

#### Scenario: 実引数が別名のリスト項目でも置換される
- **WHEN** `.map((t) => <Foo item={t} />)`の`Foo`本体が`item.done`・`item.id`を
  参照する
- **THEN** `t.done`・`t.id`相当へ置換され、コンパイラは「より大きな式」を理由と
  するscope limit errorを出さず、生成コードは動作する

#### Scenario: ハンドラの式内部で置換される
- **WHEN** `Foo`本体のハンドラが`enabled ? onActivate() : null`または
  `if (enabled) onActivate(event)`を含む
- **THEN** `enabled`と`onActivate`は呼び出し元の実引数へ置換され、ハンドラは
  その実引数を使って動作する

#### Scenario: 値なしboolean shorthandはtrueへ置換される
- **WHEN** authoredコードが`<Foo enabled />`のように値を持たない属性で
  コンポーネントを参照する
- **THEN** `enabled`の参照はboolean literal `true`へ置換され、コンパイラは
  props実行時オブジェクトを追加しない

### Requirement: 名前衝突検出時のみのコンポーネント名リネーム
コンパイラは、インライン化により生成されるルートスコープの識別子
(signal/derived出力変数名、`update_<name>()`、動きゾーン関数名)が、
既存の識別子と実際に衝突する場合に限り、衝突した側をコンポーネント名で
接頭辞化してリネームしなければならない(SHALL)。衝突が発生しない場合は
常時リネームしてはならない(SHALL NOT)。

#### Scenario: 衝突が無ければ素の名前のまま
- **WHEN** インライン化された`TodoItem`のローカルsignal名`editing`が、
  呼び出し元コンポーネントの既存の識別子と衝突しない
- **THEN** 生成コードの変数名は`editing`のままで、コンポーネント名の
  接頭辞は付かない

#### Scenario: 衝突時はコンポーネント名で明確化
- **WHEN** 2つの異なるコンポーネントがどちらも`const count = signal(0)`を
  宣言しており、両方が同じ呼び出し元スコープへインライン化される
- **THEN** 衝突した側の出力変数名は呼び出し先コンポーネント名を接頭辞に
  持つ形(例: `TodoItem_count`)にリネームされ、生成コードはどちらの
  `count`も一意な変数として参照する

### Requirement: 構造ユニットへインライン化された変数ゾーン宣言のローカルsignal化
コンパイラは、構造ユニット(リストアイテム/条件分岐ブランチ)の呼び出し
箇所へインライン化されたコンポーネントの変数ゾーンsignal/derived宣言を、
呼び出し元のモジュールスコープへ昇格させてはならない(SHALL NOT)。
代わりに、そのユニットのfactory関数のクロージャ内にローカル変数として
宣言し、対応する`update_<name>()`相当もfactory内のローカル関数として
生成しなければならない(SHALL)。

#### Scenario: リストアイテムへインライン化されたsignalはモジュールスコープに出ない
- **WHEN** `TodoItem`が`const editing = signal(false)`を持ち、
  `.map()`のアイテム位置へインライン化される
- **THEN** 生成コードのモジュールスコープに`editing`という変数・
  `update_editing`という関数は一切現れず、リストのfactory関数の内部にのみ
  存在する

#### Scenario: アイテムごとに独立したローカル状態
- **WHEN** リストが2件以上のアイテムを持ち、それぞれが独立した
  `TodoItem`インライン化を通じて`editing`ローカルsignalを持つ
- **THEN** 1つのアイテムで`editing`を書き換えても、他のアイテムの
  `editing`状態には一切影響しない(JSクロージャによるインスタンス分離)

### Requirement: 同一ボディ直下のローカルマーカーのローカルsignal依存を許可
コンパイラは、構造ユニット本体に**直接**含まれるローカルマーカー(テキスト・
属性バインディング)が、**同一ユニット内で宣言されたローカルsignal/
derived**に依存することを許可しなければならない(SHALL)。この場合、
そのユニットの既存の`update()`関数(M5、item仮引数を持つ場合に生成される)
がそのローカルマーカーを更新しなければならない(SHALL)。ルートスコープの
signal、または別ユニット・祖先ユニットで宣言されたローカルsignalへの依存は、
従来どおり`scope limit`で拒否しなければならない(SHALL)。

#### Scenario: ローカルsignalに依存する動的属性バインディングが動く
- **WHEN** リストアイテム内の`TodoItem`インライン化が`editing`ローカル
  signalと、それに同一ユニット直下で依存する動的class属性バインディング
  (`class={editing() ? 'editing' : ''}`)を持つ
- **THEN** コンパイラはscope limitエラーを出さずに完了し、生成コードを
  実行すると`editing`を書き換えるローカルハンドラの発火後にそのアイテムの
  class属性だけが切り替わる

#### Scenario: ルートsignalへの依存は引き続き拒否
- **WHEN** リストアイテム本体内のテキストマーカーがルートスコープの
  signal/derivedを直接参照する(インライン化を経由しない従来通りの形)
- **THEN** コンパイラは`(scope limit)`を含むcompile errorで拒否する
  (本changeで導入する許可の対象外)

### Requirement: ネストした構造ユニットの祖先ローカルsignal依存を明示的に拒否
コンパイラは、ネストした構造ユニット(list/conditional)の依存
(`nestedDeps`)に祖先ユニットのローカルsignal/derivedが含まれる場合、
既存の依存合流(バブリング)には乗せず、`(scope limit)`を含む
compile errorで拒否しなければならない(SHALL)。ローカルsignalの
DeclIdをグローバルな依存解決(`signalToMarkers`)へ漏らしてはならない
(SHALL NOT)。

#### Scenario: ネストした条件分岐が祖先のローカルsignalに依存する場合は拒否
- **WHEN** リストアイテム内のローカルsignal`editing`に、そのアイテム内に
  ネストした条件分岐(`editing() ? <input/> : <span>`)が依存している
- **THEN** コンパイラは`(scope limit)`を含むcompile errorで拒否し、
  モジュールスコープに存在しない変数を参照する壊れたコードを生成しない

### Requirement: children/slotの明示的な拒否
コンパイラは、コンポーネント参照JSX要素が子要素を持つ場合
(`<Component>...</Component>`)、`(scope limit)`を含むcompile errorで
拒否しなければならない(SHALL)。

#### Scenario: 子要素を持つコンポーネント参照は拒否される
- **WHEN** authoredコードが`<Wrapper><span>hi</span></Wrapper>`のように
  子要素を伴ってコンポーネントを参照する
- **THEN** コンパイラは`(scope limit)`を含むcompile errorで拒否する

### Requirement: 再帰・循環コンポーネント参照の明示的な拒否
コンパイラは、インライン化の展開中にあるコンポーネント名の集合を保持し、
展開中のコンポーネントが自分自身または展開中の祖先コンポーネントを
再度参照した場合、`(scope limit)`を含むcompile errorで拒否しなければ
ならない(SHALL)。

#### Scenario: 自己再帰参照は拒否される
- **WHEN** `function Item() { render(<Item />) }`のように自分自身を参照する
- **THEN** コンパイラは`(scope limit)`を含むcompile errorで拒否する

#### Scenario: 相互再帰参照も拒否される
- **WHEN** `A`が`B`を参照し、`B`が`A`を参照する
- **THEN** コンパイラは無限展開せずに`(scope limit)`を含むcompile error
  で拒否する
