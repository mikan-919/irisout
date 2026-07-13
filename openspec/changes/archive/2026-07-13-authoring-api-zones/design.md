## Context

現行 `compileComponent`(`src/compiler/render.ts:329-351`)は、コンポーネント
本体の文を「returnか、さもなくば signal/derived 宣言文」の二択で走査し、
最後に単一の `return <JSXElement>` を要求する。ハンドラは inline arrow 限定
(`collectAttrs`、同ファイル 234-238行)。ビルド時実行スクリプトは
`return \`<html>\`` を組み立てて初期HTMLを得ている(`src/compiler.ts:143`)。

ADR-0008 は authoring surface を **変数→UI→動き** の3ゾーンに変え、UI宣言を
`render()` マーカー、ハンドラを「render後方のfunction宣言への識別子参照」に
する(案(d): 巻き上げ)と決定済み。本changeはその実装。M4完了で実装順
(M4 → 本ADR → M5)がここに到達した。

## Goals / Non-Goals

**Goals:**
- `return <JSX>` を `render(<JSX>)` マーカーへ置き換える。
- ハンドラ属性で識別子参照を受理し、render後方のfunction宣言へ解決する。
- ゾーン配置規則(render前=const宣言のみ、render後=function宣言のみ)を
  scope limit で強制する。
- inline arrow ハンドラは温存する。

**Non-Goals:**
- 複数文のハンドラ本体・イベント引数(`e`)受け渡し → ADR-0009 に分離。
- `onMount` 等 hooks の実装(現状未実装機能)。
- ref(`ref={...}`)の設計 → ADR-0008 で M5 後に先送り。
- 動的(式コンテナ)host属性値 → 引き続き scope limit(M4 スコープ外)。

## Decisions

### 決定1: `render()` を宣言マーカーとして識別する
`compileComponent` の走査を3段に分ける: (1) `render()` 呼び出し文の位置を
特定、(2) その前の文は `processDeclarationStatement`(既存の signal/derived
処理)へ、(3) その後の文はfunction宣言テーブルへ収集。UI宣言のJSXは
`render()` の第1引数から取る。`render()` の戻り値は使わない(ADR-0006)。

**代替案**: `return` を残しつつ `render()` も許す二重サポート。→ 却下。
ADR-0008 は「コンポーネントはJSXをreturnしない」と明記。二重サポートは
配置規則の錨(「renderの前/後」)を曖昧にし、scope limit を複雑化する。

**ビルド時実行への影響**: `src/compiler.ts:143` の `return \`${html}\`` は
render() 由来の `rootHtmlSource` をそのまま使えるので、`return` 文への依存を
除くだけで済む(HTMLソースの生成経路自体は不変)。

### 決定2: 識別子参照ハンドラは「render後方function宣言テーブル」で解決
`collectAttrs` のハンドラ分岐に、値が `Identifier` の場合を追加する。
`compileComponent` が事前に集めた「render後方のfunction宣言 name→node」表を
引き、対応する宣言の本体を既存の単一式ハンドラ経路
(`analyzeHandlerExpr`)へ渡す。本体は単一の `ExpressionStatement` に限定し、
その式を `analyzeHandlerExpr` にかける。

**なぜ babel の scope binding を使わないか**: `analyze.ts` の `resolveDeclId`
は VariableDeclarator を解決するが、ここで欲しいのは「render後方に置かれた
function宣言か」という**配置**の判定。scope binding は巻き上げにより
render前のarrowも見つけてしまうため、配置ベースの明示テーブルで
「render後方のfunction宣言のみ」を担保する(ADR-0008 の配置規則そのもの)。

**代替案**: 変数ゾーンの arrow 参照も許す。→ 却下。ADR-0008 が「UIより前の
動き」として明確に禁止。テーブルに入れるのは render 後方の function 宣言だけ。

### 決定3: ゾーン配置規則は走査中に throw
- render前: `VariableDeclaration` で init が `signal()`/`derived()` 以外 →
  既存 `processDeclarationStatement` の scope limit がそのまま拒否。
  render前に `FunctionDeclaration` → 新 scope limit。
- render後: `FunctionDeclaration` 以外(const宣言・式文など)→ 新 scope limit。
- `render()` が0個 → scope limit(UI未宣言)。2個以上 → scope limit(単一UI)。

エラー書式は `docs/conventions.md` 準拠(`compile:` 始まり、`(scope limit)`
末尾)。新 scope limit ごとに、それを踏むテストを1つ足す(conventions)。

### 決定4: フィクスチャ移行
`examples/counter.jsx` 等の既存フィクスチャを `return` → `render()` +
ハンドラのfunction宣言化へ移行する。golden-output スナップショットテストが
あるため、handwritten 期待出力との差分が生成コードの意味を変えていないことを
確認する(生成される `code`/`initialHtml` は同一のはず — authoring surface の
変更であって出力の変更ではない)。

## Risks / Trade-offs

- **[巻き上げ依存の意味論] authored code が「JSの巻き上げで名前解決が合法に
  なる」ことに依存する** → ADR-0008 で計量の上受け入れ済み。irisout の
  authored code は実行されない仕様書であり実行順問題は存在しない。
- **[識別子参照とinline arrowの分岐増加] `collectAttrs` の分岐が増える** →
  値ノード型(`Identifier` / `ArrowFunctionExpression`)で素直に振り分け、
  それ以外は既存の scope limit で拒否。分岐は増えるが判定は構文だけで閉じる。
- **[出力回帰] フィクスチャ移行で生成コードが変わってしまう** → golden-output
  スナップショットと `loadGenerated()` の実行テストで、移行前後の
  `code`/`initialHtml` が一致することを確認する(移行は意味を変えない前提)。
- **[ADR-0009 との境界] function本体を単一式に限る判定が ADR-0009 実装時に
  緩む** → 本changeでは単一 `ExpressionStatement` のみ受理し、複数文は
  scope limit。ADR-0009 がこの scope limit を後で緩和する前提で境界を明示。
