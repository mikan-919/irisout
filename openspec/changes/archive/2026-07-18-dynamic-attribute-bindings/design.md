# dynamic-attribute-bindings design

## Context

設計判断そのものは ADR-0012(受理形・固定表・焼き込み位置・相乗り配線・
scope limit)。ここでは実装の織り込み方だけを決める。

現状の関連機構:
- `collectAttrs`(render.ts)は「ハンドラ / 静的 / `use=` / 拒否」の4分岐。
- テキストマーカーは要素の marker id に handler/action を相乗りさせる
  前例がある(renderElement)。
- ユニット内のローカル要素は `renderStructuralUnitBody` が ctx から splice
  して factory クロージャへ閉じ込める(localMarkers / localHandlers)。
- ビルド時実行への関数注入は escape-initial-html の `__esc__` が前例。

## Goals / Non-Goals

**Goals:** ADR-0012 の5決定を最小差分で実装する。

**Non-Goals:**
- style オブジェクト・class 配列などの値の構造化(文字列/真偽値のみ)。
- プロパティ表の拡張(checked/value 以外は setAttribute)。
- ユニット内属性式からの追跡 signal 参照(scope limit 維持)。
- todomvc.jsx の全体コンパイル(UNRESOLVED 04/08 が残るため対象外)。

## Decisions

### D1: 分類ヘルパーは template.ts に置く

`attrBindingKind(name): 'boolProp' | 'prop' | 'attr'` を template.ts に
置く(render.ts と codegen.ts の両方が使い、codegen は compiler 状態に
依存しない規約のため共有ヘルパー行き)。表は
`boolProp = {checked}` / `prop = {value}`。

### D2: AttrBinding は marker id 相乗り+deps 内蔵

```ts
interface AttrBinding {
  markerId: MarkerId
  name: string
  rendered: string        // 出力向け(update 用)
  deps: Set<DeclId>       // ユニット内 scope limit 判定用
}
```
トップレベルでは deps を要素 marker の `ctx.markerDeps` へ合流させ、
`update_<name>()` の対象にする。ユニット内では splice 時に
`deps.size > 0` を scope limit で拒否(テキストと同じ規則)し、
`localAttrBindings` として factory へ渡す。

### D3: 焼き込みは renderElement の返す開始タグ文字列に直接挿入する

トップレベル(`unitDepth === 0`)のみ:
- boolProp: `${(<sourceRendered>) ? " checked" : ""}`
- prop/attr: ` name="${__escAttr__(<sourceRendered>)}"`

ユニット内(`unitDepth > 0`)はテンプレート文字列に何も挿入しない
(factory テンプレートは innerHTML に生で渡るため、`${...}` が属性位置に
リテラル出現して HTML を壊す)。factory 側の設定行が初期値を兼ねる。

### D4: codegen は「marker id → 属性設定行」を text マーカーと同列に生成

- `update_<name>()`: markerId ごとに
  `{ const __el = __markers__.get(id); if (__el) { __el.checked = expr; __el.setAttribute("class", expr); } }`
  を出力。属性のみの marker id(markers 配列に実体が無い)でも出力する。
- factory(`generateFactory`): localAttrBindings の markerId ぶんの
  `__find__` 定数を(localMarkers と重複しないよう)確保し、item スコープ
  なら update() 内で、そうでなければ一度だけ設定する(テキストの
  refreshTexts と同じ条件分岐)。

### D5: ユニットホスト要素のハンドラは unit marker id へ配線する

renderElement の soleKind 分岐は handlerAttrs を捨てていた(silent drop、
実証済み)。要素は unit marker id の `data-iris-id` を持つので、
`ctx.handlers.push({ markerId: unitMarkerId, ...h })` の1ループで既存の
配線機構(setupLines / localHandlers splice)にそのまま乗る。動的属性も
同じ id に相乗りする。

## Risks / Trade-offs

- [ユニットホスト要素の属性 dep が unit marker deps と合流し、属性変更でも
  keyed diff が再実行される] → keyed reuse なので再 diff は冪等・安価。
  分離するには属性専用 marker が要り、1要素1 `data-iris-id` の原則を壊す。
  許容する。
- [`class=""` の焼き込み(空文字列)] → 属性削除ではなく空属性として残る。
  表示に影響なし。handwritten との差は許容(ADR-0012 代替案参照)。
- [固定表の狭さ] → 実需駆動で ADR-0012 に追記して広げる方針そのもの。
