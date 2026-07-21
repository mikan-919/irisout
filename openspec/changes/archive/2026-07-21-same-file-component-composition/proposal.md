# Proposal: same-file-component-composition

## Why

`<Component/>`のようなJSXタグ参照は同一ファイル内であっても
`compile: component references (<${tagName}/>) are not supported yet
(scope limit)`で拒否される(`src/compiler/render.ts:446`)。CONCEPT.v2.md
は「コンポーネント」「props」をirisoutの責務として明言しているが、現状の
実装はこれに到達していない。ADR-0014で「同一ファイル内合成はコンパイル時
ASTインライン化・複数ファイル対応とは切り離して先に決める」ことを決定済み
(未実装)。本changeはその実装で、`examples/todomvc.jsx`の`TodoApp`→
`TodoItem`分割を検証対象とし、あわせてROADMAP UNRESOLVED-04(アイテム
ごとの編集状態を表す暫定策の`editingId`ハック)を解消する。

## What Changes

- render-tree走査(`compileComponent`、M1〜M6)より前に、コンポーネント
  参照を解決・展開する独立した前処理パスを追加する。`<TodoItem todo={t}
  onToggle={fn} />`の呼び出し箇所へ`TodoItem`本体のASTを展開し、
  `TodoItem`自体はビルド時にも実行時にも「関数として呼ばれる」ことは
  一度もない。
- propsは`function TodoItem({ todo, onToggle }) {...}`の分割代入宣言から
  読み取り、呼び出し箇所の実引数式へのコンパイル時識別子置換として実装
  する(実行時propsオブジェクト/primitiveは新設しない)。
- ルートsignalの変数宣言・`update_<name>()`・識別子参照ハンドラの巻き
  上げが複数コンポーネント間で衝突する場合のみ、衝突した側をコンポー
  ネント名でリネームする(例: `TodoItem_count`)。衝突が無い場合は常時
  リネームしない。
- コンポーネントの変数ゾーンで宣言されたsignal/derivedが構造ユニット
  (リストアイテム/条件分岐ブランチ)へインライン化された場合、その
  `update_<name>()`相当はfactoryクロージャ内のローカル関数として生成し、
  module scopeには出さない。
- children/slot(`<Component>...</Component>`)と再帰・循環参照は
  `scope limit`エラーで明示的に拒否する(実需が出るまで対応しない)。
- `src/compiler/render.ts:446`の現行の一律拒否ロジックを、上記インライン
  化パスを通過した呼び出しは許可するよう置き換える。

## Capabilities

### New Capabilities

- `same-file-component-composition`: 同一ファイル内での`<Component/>`
  JSXタグ参照の、コンパイル時ASTインライン化による合成。呼び出し解決、
  props識別子置換、名前衝突時のリネーム、ローカルsignalのfactory
  クロージャ内生成、children/slotと再帰参照のscope limit拒否を含む。

### Modified Capabilities

(なし — 既存の`list-conditional-rendering`・`handler-statement-bodies`・
`cross-function-handler-writes`等の要件は変えない。インライン化パスは
render-tree走査より前に完結し、既存の走査ロジックは無変更のまま利用する
前提)

## Impact

- `src/compiler.ts`: `findRootComponent`(94-116行)の前後に、コンポー
  ネント参照解決・展開の前処理パスを追加する呼び出し口を設ける。
- `src/compiler/render.ts:446`: `<Component/>`の一律scope limit拒否を、
  インライン化済み呼び出しの許可判定に置き換える。
- 新規モジュール(例: `src/compiler/inline-components.ts`): コンポーネント
  解決・AST展開・props置換・名前衝突検出とリネームを実装する前処理パス
  本体。
- `src/compiler/analyze.ts`: ローカルsignalがfactoryクロージャ内で
  ローカル関数として`update_*()`を生成する既存経路(M5/M5.5)との整合。
- `examples/todomvc.jsx`: `TodoApp`から`TodoItem`を切り出し、検証フィク
  スチャとして更新。`editingId`ハックを`TodoItem`内の`const editing =
  signal(false)`に置き換える。
- テスト: インライン化・props置換・名前衝突リネーム・ローカルsignal
  factory化・children/slot拒否・再帰参照拒否の各ケース。
