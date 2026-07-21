# scope-limit-coverage design

## Context

`compile()` はルートコンポーネント関数だけを見ており、Program 直下の他の文は
一切検査しない。また `processDeclarationStatement`(`src/compiler/render.ts`)
は宣言子の `id` を `as t.Identifier` で無検証キャストする。どちらも非対応
構文がビルド時実行(`new Function`)まで素通りし、生 `ReferenceError` として
ユーザーに露出する。エラー規約(`compile:` プレフィックス + `(scope limit)`)
の網羅性の穴。

## Goals / Non-Goals

**Goals:**

- 実証済みの2経路(分割代入宣言子・コンポーネント外トップレベル文)を
  構文検査段階で `compile:` エラーにする。
- ビルド時実行の例外を `compile:` 付きで包む安全網を足し、今後の
  取りこぼしも生エラーで露出しないようにする。

**Non-Goals:**

- 受理範囲の拡大(トップレベル const の実サポート等)。本 change は拒否を
  明示化するだけで、コンパイラの受理条件は一切緩めない
  (docs/architecture.md: 受理条件を場当たりに緩めない)。
- ハンドラ/式解析内部の網羅性監査(別件。既存の scope limit 群で概ね
  カバー済み)。

## Decisions

### D1: 宣言子 id は Identifier のみ受理

`processDeclarationStatement` のキャスト前に `declarator.id.type !==
'Identifier'` を検査し、
`compile: destructuring signal()/derived() declarations are not supported (scope limit)`
で拒否する。最小の1ガード。

### D2: Program 直下は「関数宣言(export 込み)」のみ受理

`compile()`(または `findRootComponent` の走査時)で `ast.program.body` を
検証し、`FunctionDeclaration` と `ExportNamedDeclaration`(中身が
`FunctionDeclaration`)以外の文は
`compile: only top-level function declarations are supported (scope limit)`
で拒否する。import 文・トップレベル const・副作用式も現時点の実装では
出力に反映されない(黙って捨てられる)ため、一律拒否が正直な挙動。
将来トップレベル定数を受理するときに、この1箇所を緩めればよい。

### D3: ビルド時実行を try/catch で包む安全網

`runComponent(signal, derived)` を try/catch し、例外を
`compile: build-time execution failed: <元メッセージ>` で再 throw する。
D1/D2 をすり抜ける未知の経路が残っても、少なくとも「コンパイルの失敗」
として報告される。元エラーは `cause` に保持する。

## Risks / Trade-offs

- [TypeScript の型宣言文(`interface`/`type`)もD2で拒否される] → 現状の
  authored `.jsx` に型宣言はなく、JSX 型検査基盤は別 change(STATUS.md)で
  一括整備する予定なので、そのときに受理を広げる。
- [D2 が将来の import 対応を塞ぐ] → scope limit の緩和は受理条件の明示的な
  設計判断として行う方針そのもの。拒否メッセージが起点になる。
