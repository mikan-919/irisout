# adr-0009-handler-statements

## Why

ADR-0008 が決めたゾーン API の決定例そのもの
(`function handleCountUp() { state(state() + 1) }`)が、現行コンパイラでは
「本体は単一の式文に限る」scope limit で通らない。`signal(x)` → `signal = x`
の書き込み変換(M2)を文レベルのブロック本体へ広げ、イベント引数(`e`)を
受け渡せるようにしないと、TodoMVC の全ハンドラ
(`examples/todomvc.jsx:107-136`)がコンパイルできない。設計はドラフト
ADR-0009 で検証済み(スクラッチ実験で scope 解決の安全性を確認)。本変更で
ドラフトを承認済みへ格上げし、実装する。

## What Changes

- ハンドラのブロック本体を受理する: `ExpressionStatement` /
  `VariableDeclaration`(`const`/`let` ローカル)/ `IfStatement` /
  `ReturnStatement` の4文種(ADR-0009 質問2)。inline arrow・識別子参照
  function 宣言の両形で同じ解析を共有する(質問5)。
- ハンドラの第1仮引数(イベントオブジェクト)を受理し、authored 引数名を
  そのままラッパー仮引数へ昇格する(質問1)。分割代入引数は scope limit の
  まま拒否。
- `analyzeHandlerExpr` を文レベルへ拡張する: 既存の edit ベース `visit`
  (追跡呼び出し `signal(x)` → `signal = x` 書き換え、`writeDeclIds` 収集)を
  そのまま文の配列へ適用する(質問4)。
- 条件分岐内の書き込みは静的過剰近似で検出する(実行時到達に関わらず
  `update_*()` を出す、質問3)。
- ループ・`try`/`switch`・関数/クラス宣言など4文種の外は引き続き
  `compile: ... (scope limit)` で明示拒否。
- ADR-0009 のステータスを「ドラフト」→「承認済み」へ更新し、STATUS.md の
  既知の制約(単一式限定)を解消として更新する。

## Capabilities

### New Capabilities

- `handler-statement-bodies`: ハンドラのブロック本体(4文種)の文レベル解析、
  イベント引数の受け渡し、文中の signal 書き込み(`signal(x)` → `signal = x`)
  の検出・変換、4文種外の明示拒否。

### Modified Capabilities

- `component-authoring-zones`: 「識別子参照ハンドラの解決先 function 宣言の
  本体は単一の式文に限る」という要件を廃し、ブロック本体(4文種)を受理する
  要件へ置き換える(複数文本体の拒否シナリオが「未対応文種の拒否」へ変わる)。

## Impact

- `src/compiler/render.ts` — `resolveHandlerBody` の単一式・引数ゼロ制限を
  4文種+第1引数の受理へ緩和。
- `src/compiler/analyze.ts` — `analyzeHandlerExpr` の入力を式から文の配列へ
  拡張(edit ベース `visit` は再利用)。
- `src/codegen.ts` — ハンドララッパー `(...__args)` に authored 引数名を束縛
  (`(e, ...__args)` 形)。
- `test/handlers.test.ts` ほか — ブロック本体・イベント引数・新 scope limit の
  テスト追加。golden スナップショットの更新。
- `docs/adr/0009-handler-statements-and-event-object.md` — ステータス更新。
- `STATUS.md` / `ROADMAP.md` — 制約解消・UNRESOLVED(09) の進捗反映。
- 破壊的変更なし(受理範囲が広がる方向のみ)。
