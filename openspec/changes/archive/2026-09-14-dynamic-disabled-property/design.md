# dynamic-disabled-property design

## Decision

`packages/compiler/src/template.ts`の固定表で`checked`と`disabled`を`boolProp`
として分類する。既存の`render.ts`と`codegen.ts`の経路を使い、トップレベルの
初期HTMLはtrueのときだけpresence属性を含め、factoryと更新関数はDOMプロパティを
代入する。

boolean属性を網羅的に推論する表は追加しない。実需が出た属性だけをADR-0012へ
追加する。
