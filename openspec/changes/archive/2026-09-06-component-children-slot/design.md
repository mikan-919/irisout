## 設計

1. `inline-components.ts`が呼び出し側のJSX子ノードから空白だけのJSXTextを除いた列を
   作る。`children`をshorthand分割代入したcomponentでは、clone済み本体のbindingを
   取得し、`{children}`がcomponent本体のJSX要素の直接の子である場合だけ、その位置を
   子ノードのclone列へ置き換える。
2. 子ノードはcomponent本体のcloneへ一時的に挿入された後、render JSXが呼び出し側へ
   移される。移動後のscope crawlで、slot内のsignal・handler・component参照を呼び出し
   側の字句scopeへ解決する。
3. `children`の属性値は、`children`を宣言したcomponentに限り、文字列または式を
   slot子ノードへ変換する。JSX子要素との併用は拒否する。属性・handler・他の式に
   使われた`children`参照は、実行時slot値を定義しないためscope limitとする。
4. 展開後の走査は既存の`renderElement`を使う。mixed reactive text、fragment、spread
   childなどの診断やruntimeはchildren経路で複製しない。
