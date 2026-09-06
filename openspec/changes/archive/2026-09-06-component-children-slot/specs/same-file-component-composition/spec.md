## 変更する要件

### Requirement: children slotのコンパイル時展開
コンパイラは、`children`をshorthand分割代入したcomponentへの
`<Component>...</Component>`参照を受理し、空白だけのJSXTextを除く呼び出し側の子
ノード列をcomponent本体のJSX要素にある直接の`{children}`へASTとして展開しなければ
ならない(SHALL)。展開は既存のcomponent ASTインライン化とrender-tree走査の間に
完了しなければならず、実行時props object、slot配列、子component objectを生成しては
ならない(SHALL NOT)。

#### Scenario: children propへJSX子要素を展開する
- **WHEN** `function Wrapper({ children }) { render(<section>{children}</section>) }`へ
  `<Wrapper><span>hi</span></Wrapper>`を渡す
- **THEN** コンパイラは`span`を`section`の子へ展開し、`Wrapper`の実行時呼び出しや
  slot runtimeを含まない生成物を出力する

#### Scenario: 複数の子要素と動的式を展開する
- **WHEN** `<Wrapper><span>{label()}</span><button onClick={change}/></Wrapper>`を
  渡し、Wrapperが`{children}`を直接のJSX子位置で使う
- **THEN** 子要素、動的テキスト、handlerは展開後のASTとして既存のsignal依存・
  event・構造unit解析へ渡される

#### Scenario: children propを宣言しないcomponentは拒否する
- **WHEN** `function Wrapper() { render(<section>wrap</section>) }`へ
  `<Wrapper><span>hi</span></Wrapper>`を渡す
- **THEN** コンパイラは`children`宣言を要求する`(scope limit)`を含むcompile errorを出す

#### Scenario: childrenの参照位置を制限する
- **WHEN** componentが`children`を属性値、handler、他の式、または別componentのpropへ
  渡す
- **THEN** コンパイラは直接のJSX子位置だけを受理し、`(scope limit)`を含むcompile
  errorで拒否する

#### Scenario: 展開後の既存制約を適用する
- **WHEN** slotへ展開された子ノードが既存のrender-tree未対応形式になる
- **THEN** コンパイラはslot専用のruntimeや変換を追加せず、展開後のASTに対する既存の
  `(scope limit)`エラーを出す
