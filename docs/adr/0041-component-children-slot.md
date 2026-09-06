# ADR-0041: componentの`children` slot展開

## ステータス

**決定済み・実装済み**(change `component-children-slot`、2026-09-06)

## 背景

同一ファイルcomponentは`<Component/>`の形だけを受理していた。共通パネルのような
表示枠をcomponentへ切り出すには、呼び出し側のJSXを`<Panel>...</Panel>`で渡す
children slotが必要になった。

irisoutのcomponentはコンパイル時ASTインライン化で境界を消す。実行時props objectや
子component objectを追加せず、slotも同じ前処理で解決する。

## 決定

### 1. `children` propを直接のJSX子位置へ展開する

`function Panel({ children }) { render(<section>{children}</section>) }`に対する
`<Panel><p>text</p></Panel>`を受理する。呼び出し側の意味のある子ノード列を
component本体の`{children}`へASTとして複製し、inline化後のrender-tree走査へ渡す。
空白だけのJSXTextは子ノードに含めない。

子ノードのevent、signal、構造unit、同一ファイルcomponent参照は、展開後のASTとして
既存の解析・更新経路へ渡す。実行時slot配列、仮想DOM、props wrapperは生成しない。

### 2. `children`はshorthand分割代入で宣言する

component側は既存のprops契約に従い、`function Panel({ children })`のように宣言する。
子要素を渡すcomponentが`children` propを宣言しない場合はscope limitで拒否する。
`children="text"`や`children={expression}`の直接属性も、`children`を宣言したcomponent
ではslotの子ノードへ変換する。ただし、同じ呼び出しで直接属性とJSX子要素を併用する
場合は拒否する。

### 3. slotの使用位置を制限する

`children`の参照はcomponent本体のJSX要素の直接の子位置にある
`{children}`だけを受理する。属性値、handler、他の式、別componentのpropへ渡す参照は
実行時の子値の意味を追加で定める必要があるためscope limitで拒否する。

展開された子ノードが既存のrender-tree制約に違反する場合は、展開後のASTに対する
既存のscope limit診断を出す。JSX fragment、spread child、要素と反応テキストを混在
させる形など、既存のrenderが未対応の形をslot専用経路で拡張しない。

## 結果

`<Panel>...</Panel>`は同一ファイルcomponentのroot、条件分岐、list itemの各位置で
同じAST inline化経路を使える。slotを使わないcomponentの生成物とruntimeには追加の
処理を出力しない。複数ファイルのcomponent解決、再帰・循環component参照は
ADR-0014の範囲どおり別の制約として残る。
