# authored-jsx-type-checking

## Purpose

authored `.jsx`(`examples/counter.jsx`・`examples/todomvc.jsx`)向けの
静的型検査基盤(ROADMAP次のアクション10、change
`jsx-type-checking-foundation`)を規定する。`types/jsx.d.ts`のグローバル
`JSX`namespace・`signal`/`derived`/`render`のグローバル関数シグネチャと、
examples専用の`examples/tsconfig.json`(ルートの`tsconfig.json`とは独立)
で構成される。型はあくまで静的検査用であり、コンパイラ
(`src/compiler/*`)の実行時受理/拒否ロジック(scope limit)には一切
影響しない。属性名レベルの厳密なホワイトリスト化・コンポーネントprops
の厳密な型推論は対象外(必要最小限の`any`/`unknown`ベースに留める)。

## Requirements

### Requirement: authored .jsx が tsc の型検査対象に含まれる
`examples/tsconfig.json`(examples専用の独立したTSプロジェクト。
ルートの`tsconfig.json`は変更しない)は`examples/**/*.jsx`を型検査対象
として含む SHALL。`allowJs`・`checkJs`・`jsx: "preserve"`が有効で
なければならない(MUST)。`bun run typecheck`は、ルートプロジェクトに
加えて`examples/tsconfig.json`に対しても`tsc --noEmit`を実行し、
型エラーがあれば非ゼロ終了しなければならない(MUST)。

#### Scenario: 既存の authored .jsx が型エラーなく通る
- **WHEN** `bun run typecheck`を実行する
- **THEN** `examples/counter.jsx`・`examples/todomvc.jsx`のいずれについても
  型エラーが報告されない

#### Scenario: 存在しないグローバル関数を呼ぶと型エラーになる
- **WHEN** authored `.jsx`内で未宣言のグローバル関数(例:
  `signal`/`derived`/`render`のいずれでもない不明な識別子)を呼び出す
- **THEN** `tsc --noEmit`は型エラーを報告する

### Requirement: signal/derived/render のグローバル型宣言
`signal`・`derived`・`render`は`types/jsx.d.ts`でグローバル関数として
型宣言されなければならない(MUST)。authored `.jsx`からimportなしで
型付きで呼び出せなければならない(MUST)。
`signal<T>(initial: T)`は読み書き両用の関数
(`(): T`と`(next: T): void`の両方の呼び出し形)を返す SHALL。
`derived<T>(compute: () => T)`は`() => T`を返す SHALL。
`render(element: JSX.Element): void`はJSX式を1つ受け取る SHALL。

#### Scenario: signal の読み書き両方の呼び出し形が型付けされる
- **WHEN** `const count = signal(0)`のあと`count()`(読み取り)と
  `count(1)`(書き込み)の両方を呼ぶ
- **THEN** どちらの呼び出し形も型エラーにならず、`count()`の返り値型は
  `number`と推論される

#### Scenario: signal の初期値と異なる型を書き込むと型エラーになる
- **WHEN** `const count = signal(0)`のあと`count('x')`のように初期値と
  異なる型の値を書き込む
- **THEN** `tsc --noEmit`は型エラーを報告する

### Requirement: JSX intrinsic 要素の型宣言
`types/jsx.d.ts`はグローバル`JSX.IntrinsicElements`を宣言しなければ
ならない(MUST)。DOMの`HTMLElementTagNameMap`に存在するタグ名のみを
許可する SHALL。存在しないタグ名は型エラーにしなければならない(MUST)。
各intrinsic要素は共通属性として`key`(list item用)・`use`(ADR-0011の
action接続)・`onXxx`パターンのイベントハンドラ属性・`children`を
受け付ける SHALL。それ以外の属性名は緩い`string`キーで許容する SHALL
(属性名レベルのホワイトリスト化はしない ― design.md Decision 3参照)。

#### Scenario: 存在するタグ名は型エラーにならない
- **WHEN** `<div>`・`<p>`・`<button>`・`<input>`・`<ul>`・`<li>`・`<span>`の
  いずれかを使う
- **THEN** タグ名に起因する型エラーは発生しない

#### Scenario: 存在しないタグ名は型エラーになる
- **WHEN** `HTMLElementTagNameMap`に存在しないタグ名(例:
  `<nonexistent-tag>`)を使う
- **THEN** `tsc --noEmit`は型エラーを報告する

#### Scenario: onXxx ハンドラ属性が型付けされる
- **WHEN** `<button onClick={() => {}}>`のように`onXxx`パターンの属性へ
  関数を渡す
- **THEN** 型エラーにならない

#### Scenario: use 属性が型付けされる
- **WHEN** `<input use={(el) => { /* ... */ }}>`のように要素を受け取る
  関数、または要素を受け取り関数を返す関数(再描画クロージャ)を`use`へ
  渡す
- **THEN** どちらの形も型エラーにならない

### Requirement: 型検査は実行時 scope limit の代替ではない
`types/jsx.d.ts`が特定の構文(例: リストアイテム内の`use=`)を型上
許可していても、それは実行時にコンパイラの`scope limit`拒否を免れることを
意味してはならない(MUST NOT)。この非対称性はdesign.mdおよびコード内
コメントに明記しなければならない(MUST)。

#### Scenario: 型上は書けるが実行時は scope limit のままの構文がある
- **WHEN** リストアイテム内の要素に`use=`属性を書く
- **THEN** `tsc --noEmit`は型エラーを報告しないが、`compile()`は
  `compile: use= inside list/conditional units is not supported yet (scope limit)`
  で拒否する(挙動は本changeで変更しない)
