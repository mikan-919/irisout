## Why

現行のauthoring APIは「単一の `return <JSX>`」を前提とし、ハンドラは
inline arrow限定(`src/compiler/render.ts` のscope limit)。このためJSX内に
動きが散らばり、リアクティブな記述をまとめられない。ADR-0008で
**変数→UI→動き** の3ゾーン構造を採用すると決定済みで、M4完了により
実装順(M4 → 本ADR → M5)がこのステップに到達した。

## What Changes

- **BREAKING**: コンポーネントはJSXを `return` しない。UI宣言は値を返さない
  マーカー呼び出し `render(<JSX>)`(`signal()` と同列のビルド時に消える
  宣言イディオム、ADR-0006)で行う。`compileComponent` の「単一の
  `return <JSXElement>`」前提を覆す。
- ハンドラ属性で **識別子参照**(`onClick={handleCountUp}`)を許可する。
  参照先は `render()` 文より**後ろ**に置いたfunction宣言に限る。JSの巻き上げに
  より合法TSで、型・rename・go-to-defが効く(ADR-0008 案(d))。
- inline arrow(`onClick={() => ...}`)は引き続き許容する。UIゾーンの中は
  「UI宣言以降」なので配置規則に違反しない(ADR-0008)。
- **ゾーン配置規則をscope limitとして強制する**: `render()` より前は
  const宣言(signal/derived)のみ、`render()` より後ろはfunction宣言のみ。
  違反は黙って通さずcompile error(`compile: ... (scope limit)`)。
  - 変数ゾーンに `const handleFoo = () => ...` を書いてJSXから参照する形
    (=「UIより前の動き」)は拒否する。識別子参照の解決先はrenderより後ろの
    function宣言に限る。
- 既存フィクスチャ(`examples/counter.jsx` ほか)をゾーン構造へ移行する。

**スコープ外(このchangeでは扱わない)**:
- ハンドラfunction宣言の本体は **単一の式文** のみ対応。複数文の本体・
  イベント引数(`e`)の受け渡しは **ADR-0009(handler-statements)** に分離。
- `onMount` 等のhooks本体の実装(配置規則はfunction宣言と同じだが、hooks
  そのものは現状未実装機能で本changeの対象外)。
- ref(`ref={...}`)の設計(ADR-0008でM5後に先送りと明記)。

## Capabilities

### New Capabilities
- `component-authoring-zones`: コンポーネントを変数ゾーン→UIゾーン(`render()`)
  →動きゾーン(function宣言)の3構造で解釈する。`render()` マーカーの認識、
  識別子参照ハンドラの巻き上げfunction宣言への解決、ゾーン配置違反の
  compile errorによる拒否を規定する。

### Modified Capabilities
<!-- 要件レベルで変わる既存specはなし。static-host-attributes の属性処理・
     ハンドラ配線の意味は不変で、呼び出し元(compileComponent)の走査だけが
     変わるため実装詳細に留まる。 -->

## Impact

- `src/compiler/render.ts` — `compileComponent` のstatement走査を
  ゾーン認識(render前/render/render後)へ書き換え。`collectAttrs` の
  ハンドラ分岐に「識別子参照 → 後方function宣言の解決」を追加。
- `src/compiler.ts` — ビルド時実行スクリプト組み立てで `return \`...\`` を
  生成している箇所(現在 `return` 文に依存)を `render()` 経由の
  HTMLソース取得へ調整。
- `examples/*.jsx` — `return <JSX>` → `render(<JSX>)` + ハンドラのfunction宣言化。
- `test/*.test.ts` — 既存の `return` 前提フィクスチャの移行、新scope limit
  (配置違反・変数ゾーンのarrow参照)を踏むテストの追加。
- 依存追加なし。ADR-0009(handler-statements)は本changeの上に積む。
