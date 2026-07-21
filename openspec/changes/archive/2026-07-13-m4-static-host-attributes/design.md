## Context

`src/compiler/render.ts` の `collectHandlerAttrs` は、host 要素の JSX 属性を
1本のループで走査し、`on[A-Z]...` ハンドラ以外の属性(spread も含む)を
一律 `compile: host element attributes are not supported yet (scope limit)`
で拒否している。テンプレート HTML の組み立ては `renderElement` が
`<${tagName}>` / `<${tagName} data-iris-id="${markerId}">` という2パターンを
直接文字列結合しているだけで、属性を追加で埋め込む口がまだない。

`src/template.ts` には `escapeAttrValue`(HTML 属性値エスケープ)が既に
実装済みだが、どこからも呼ばれていない ― この変更で使う想定で先に置かれた
ヘルパーとみなせる。

`examples/counter.jsx`(`<button type='button'>`)は現状このスコープ限界に
より compile error になり、`examples/todomvc.jsx`(`class='todoapp'` 等)も
同様。

## Goals / Non-Goals

**Goals:**
- 静的文字列属性・値なし真偽属性を host 要素の初期 HTML テンプレートへ
  反映する。
- `examples/counter.jsx` / `examples/todomvc.jsx` の静的属性がそのまま
  compile を通るようにする。
- 既存のハンドラ属性収集・マーカー発行ロジックは変更しない(属性走査の
  分岐を追加するのみ)。

**Non-Goals:**
- 動的(式コンテナ)属性値のサポート ― 定数式判定も含め、一切行わない。
- `className`→`class` のような属性名エイリアス変換。
- spread 属性のサポート。
- SVG 名前空間属性(`JSXNamespacedName`、例 `xlink:href`)のサポート。

## Decisions

### 1. 属性走査を「ハンドラ / 静的 / 拒否」の3分岐にする

`collectHandlerAttrs` の1属性ずつのループに分岐を追加する(関数名は
`collectAttrs` に改名し、戻り値を `{ handlerAttrs, staticAttrs }` に拡張):

- 属性名が `on[A-Z]...` にマッチ → 既存のハンドラ処理(変更なし)。
- それ以外で `attr.node.value` が `StringLiteral` または `null`
  (valueless)、かつ属性名が `JSXIdentifier` → 静的属性として
  `staticAttrs` に積む。
- それ以外(`JSXExpressionContainer` 値、`JSXNamespacedName`、spread)→
  既存の scope limit エラーを投げる。

分岐を1つの走査ループに同居させるのは、属性ごとに「ハンドラか静的か拒否か」
を決める判定がその場で完結し、複数回 AST を歩く理由がないため
(conventions.md: ctx を受け取るモジュールの走査は素直にまとめる)。

### 2. 静的属性の文字列化は `template.ts` に1関数追加する

`renderStaticAttrs(attrs: StaticAttr[]): string` を `template.ts` に追加し、
`escapeAttrValue`(既存)を使って ` name="value"` / ` name`
(valueless)を連結した文字列を返す。`renderElement` はこれを
`<${tagName}${renderStaticAttrs(staticAttrs)}${markerPart}>` の形で開始
タグに差し込む。codegen 側の追加変更は不要(`renderElement` が組み立てる
テンプレートソース文字列がそのまま `codegen.ts` に渡る既存の経路を使う)。

`renderStaticAttrs` を `render.ts` ではなく `template.ts` に置くのは、
`escapeAttrValue` 等の文字列組み立てヘルパーが既にそこに集約されている
既存の役割分担(`docs/architecture.md` のモジュール表)に従うため。

### 3. マーカー・依存グラフには一切乗せない

静的属性は `ctx.markers` / `ctx.markerDeps` に登録しない。反応性が
不要な情報を依存グラフに乗せると `resolveToSignals()` の走査対象が
無駄に増えるだけでなく、「なぜこの属性に依存追跡があるのか」という
将来の読み手の疑問を生む(ADR-0004: ソースが要求しない機構を足さない)。

### 4. 式コンテナ値は中身を見ずに拒否する

`class={active() ? 'a' : 'b'}` も `tabIndex={0}` も同じ
`JSXExpressionContainer` 値である以上、区別のために式の中身を評価・解析
すると `analyze.ts` の依存解析を先取りすることになり、M4 のスコープを
超える。構文だけで判定できる境界(値が `StringLiteral` か `null` か)を
そのまま拒否/受理の分岐にする。

## Risks / Trade-offs

- [値なし属性のブール表現(`disabled` は HTML 上「存在すれば true」)を
  誤って `="true"` のような文字列値で出力してしまうと、
  ブラウザの実際の属性挙動と乖離する] →
  `staticAttrs` の型で valueless を独立した種別として保持し
  (`{ name, value: string } | { name, valueless: true }` 等)、
  `renderStaticAttrs` 側で分岐して出力する。テストで
  `<input disabled>` の生成 HTML に `="..."` が付かないことを直接検証する。
- [属性値エスケープの抜け(二重引用符・アンパサンド以外の文字)] →
  `escapeAttrValue` は既存実装をそのまま使う(新規に書かない)。
  カバー範囲を広げる必要が出た場合は `escapeAttrValue` 自体を直す。

## Migration Plan

新規 codegen 経路の追加のみで、既存の出力形(ハンドラのみの要素・reactive
text マーカーの要素)には変更がない。破壊的変更はなし。実装後
`examples/counter.jsx` と `examples/todomvc.jsx` を実際に `compile()` に
通して compile error が出ないことを手動確認する(`ROADMAP.md` の
`scripts/build.ts` 手動計測と同じ運用)。
