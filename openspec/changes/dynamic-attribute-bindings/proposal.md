# dynamic-attribute-bindings

## Why

TodoMVC パリティの残穴 UNRESOLVED(02)/(03)(ROADMAP「次のアクション」8):
`class={todo.completed ? 'completed' : ''}` のような動的文字列属性と、
`checked={todo.completed}` のような DOM プロパティ反映が書けず、
式コンテナ値の host 属性は一律 scope limit で拒否されている。M6 完了で
全マイルストーンが DONE になった今、これが最後の計画済みパリティ穴。
設計判断は ADR-0012 に記録済み。

## What Changes

- 式コンテナ値の host 属性を「動的属性バインディング」として受理する
  (ADR-0012 決定1)。
- attribute/property の使い分けは固定表(`checked` = boolean プロパティ、
  `value` = 文字列プロパティ、他は `setAttribute`)(ADR-0012 決定2)。
- 初期値はトップレベルのみビルド時実行で焼き込み(属性文脈エスケープ
  `__escAttr__` を注入)、構造ユニット内は factory が設定(ADR-0012 決定3)。
- 更新は既存マーカー機構に相乗り: トップレベルは `update_<name>()`、
  item スコープは factory の `update()` で再設定(ADR-0012 決定4)。
- ユニット内の追跡 signal 参照はテキストと同じ scope limit(ADR-0012 決定5)。
- **計画外バグ修正**: 構造ユニットを唯一の子に持つ要素のハンドラ
  (`<ul onClick={...}>{items().map(...)}</ul>`)が黙って捨てられていた
  (レビューで発見・実証済み)。ユニットのマーカー id へ配線する。

## Capabilities

### New Capabilities

- `dynamic-attribute-bindings`: 式コンテナ値の host 属性の受理・
  attribute/property 反映・初期焼き込み・更新配線。

### Modified Capabilities

- `static-host-attributes`: 「式コンテナ属性値の拒否」要件を「動的属性
  バインディングとして受理する」に置き換える(spread・namespaced の拒否は
  維持)。
- `list-conditional-rendering`: ユニットホスト要素のハンドラ配線の要件を
  追加(silent drop の修正)。

## Impact

- `src/template.ts`: 属性の binding 分類ヘルパー(共有表)。
- `src/compiler/state.ts`: `AttrBinding` 型、`ctx.attrBindings`、
  `StructuralUnitBody.localAttrBindings`。
- `src/compiler/render.ts`: collectAttrs の第4分類、焼き込み、ユニット内
  splice、ユニットホストのハンドラ配線修正。
- `src/compiler.ts`: `__escAttr__` の注入、codegen への受け渡し。
- `src/codegen.ts`: `update_<name>()` / factory への属性再設定行の生成。
- `test/dynamic-attrs.test.ts`(新規)+ ユニットホストハンドラのテスト。
- `examples/todomvc.jsx`: UNRESOLVED(02)/(03) コメントの解消(本文は
  既に目標形で書かれている)。
