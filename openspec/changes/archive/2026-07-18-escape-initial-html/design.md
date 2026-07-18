# escape-initial-html design

## Context

初期 HTML はビルド時実行(`src/compiler.ts` の `new Function` に
`return \`${rootHtmlSource}\`;` を渡す)で得る。`rootHtmlSource` のテキスト
マーカー部分は `buildTextMarker`(`src/compiler/render.ts`)が組み立てた
`sourceInner` で、式値 `${sourceRendered}` が**未エスケープ**のまま HTML
文字列に連結される。一方、実行時更新(`update_*`)は `textContent` 代入
なので HTML を解釈しない。この非対称が注入穴とハイドレーション不整合の
原因。

静的属性値は `escapeAttrValue`(`src/template.ts`)で既にエスケープ済み。
JSXText 静的部分は JSX 構文上 生の `<` を含めない。穴は**式値のみ**。

## Goals / Non-Goals

**Goals:**

- ビルド時実行で焼き込まれる式値を HTML エスケープし、初期表示と
  `textContent` 更新後の表示を同一にする。

**Non-Goals:**

- 生成モジュール(出力コード)の変更。`textContent` は HTML を解釈しない
  ので出力側にエスケープは不要(ADR-0004: 出力を膨らませない)。
- 構造ユニット body テンプレート内の `${...}` プレースホルダ文字列の扱い
  (innerHTML に一瞬載るが factory が即 textContent で上書きする静的文字列
  であり、authored 値は流れない)。
- 属性値エスケープ(実装済み)。

## Decisions

### D1: エスケープは sourceParts の式コードを包む1点で行う

`buildTextMarker` で `sourceParts` に積む式を
`{ type: 'expr', code: \`__esc__(${sourceRendered})\` }` に変える。
`innerTemplateSource` や `escapeTemplateText` は出力側(textContent 用)と
共有しているため触らない — 共有ヘルパーにモード引数を足すより、ビルド時
専用パスの1箇所で包むほうが影響範囲が明確。

### D2: `__esc__` は `new Function` の第3引数として注入する

`new Function('signal', 'derived', '__esc__', body)` にし、compiler.ts 側で
`(v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')` を渡す。
テキストノード文脈なので `&` と `<` で十分(属性文脈には使わない)。
ソースへの文字列 inline より、authored コードと注入ヘルパーの名前衝突を
`__esc__` 予約1つに限定できる。

## Risks / Trade-offs

- [authored コードが `__esc__` という識別子を使うと衝突する] → 現実的に
  ほぼ起きない。起きた場合はビルド時実行が誤動作するが、`__` プレフィックス
  は生成コードの既存慣習(`__markers__` 等)と同じ予約空間。
- [既存 golden スナップショットの変化] → 特殊文字を含まないフィクスチャの
  `initialHtml` は不変のはず。変わったらそれ自体がバグ検出。
