## MODIFIED Requirements

### Requirement: 構造ユニットのローカルsignal依存と所有者更新
構造unitの直接markerとネストした構造unitは、そのunitまたは祖先unitで宣言した
local signal/derivedを参照できなければならない(SHALL)。書き込みhandlerは宣言
factoryのupdateへ接続し、local DeclIdをroot依存表へ漏らしてはならない(SHALL NOT)。
root signalの直接テキスト/属性依存と字句スコープ外localはscope limitで拒否する。

#### Scenario: TodoItemの自然な編集条件
- **WHEN** itemへ展開されたcomponentがlocal `editing`を持ち、
  `editing() ? <input /> : <span />`と各branchのhandlerを記述する
- **THEN** itemごとのfactoryが編集状態を所有し、dblclickとblurでbranchを切り替える

#### Scenario: 祖先local signalを使う内側unit
- **WHEN** inner conditional/Listがancestor factoryのlocal signalを読む
- **THEN** scope limitで拒否せず、ancestor updateからinner unitを更新する

#### Scenario: ローカルsignalに依存する動的属性バインディングが動く
- **WHEN** リストアイテム内の`TodoItem`インライン化が`editing`ローカル
  signalと、それに同一ユニット直下で依存する動的class属性バインディング
  (`class={editing() ? 'editing' : ''}`)を持つ
- **THEN** コンパイラはscope limitエラーを出さずに完了し、生成コードを
  実行すると`editing`を書き換えるローカルハンドラの発火後にそのアイテムの
  class属性だけが切り替わる

#### Scenario: TodoItemの自然な編集条件が動く
- **WHEN** リストitemへ展開された`TodoItem`が`const editing = signal(false)`を
  持ち、`editing() ? <input onBlur={() => editing(false)} /> :
  <span onDblClick={() => editing(true)} />`を含む
- **THEN** コンパイラはネストした条件分岐をitem factory内へ生成し、spanの
  dblclickとinputのblurが同じitemの`editing`を更新し、input/spanを切り替える

#### Scenario: 祖先ローカルsignalを使うネストunitが動く
- **WHEN** itemのローカルsignalが内側条件分岐の条件式、内側リストの配列式、
  または内側handlerの書き込み先になる
- **THEN** コンパイラはscope limitエラーを出さず、祖先factoryの更新から
  内側unitの条件分岐・List・binding更新へ接続する

#### Scenario: ルートsignalへの依存は引き続き拒否
- **WHEN** リストアイテム本体内のテキストマーカーがルートスコープの
  signal/derivedを直接参照する(インライン化を経由しない従来通りの形)
- **THEN** コンパイラは`(scope limit)`を含むcompile errorで拒否する
  (本changeで導入する許可の対象外)

### Requirement: 字句スコープ外のローカルsignal依存を拒否
別unitのlocal signalを参照する構造unitは、`(scope limit)`を含むcompile errorで
拒否しなければならない(SHALL)。

#### Scenario: 字句スコープ外のローカルsignalは拒否
- **WHEN** ある構造ユニットの内側unitが、兄弟unitなど参照できない別unitの
  ローカルsignalに依存している
- **THEN** コンパイラは`(scope limit)`を含むcompile errorで拒否し、モジュール
  スコープに存在しない変数を参照するコードを生成しない
