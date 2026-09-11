# authored-jsx-type-checking

## Purpose

authored `.jsx`向けの静的型検査を規定する。`types/jsx.d.ts`のグローバル
`JSX`namespace・authoring API・要素別イベント型、JSDocで宣言するコンポーネントの
props形状、examples専用の`apps/examples/tsconfig.json`で構成される。型は静的検査用で、
コンパイラの実行時受理・拒否には影響しない。属性名のホワイトリスト化と、JSDocのない
コンポーネントpropsの自動推論は対象外とする。

## Requirements

### Requirement: authored .jsx が tsc の型検査対象に含まれる
`apps/examples/tsconfig.json`(examples専用の独立したTSプロジェクト。
ルートの`tsconfig.json`は変更しない)は`apps/examples/**/*.jsx`と型検査専用の
`types/test/**/*.jsx`を型検査対象として含む SHALL。`allowJs`・`checkJs`・
`jsx: "preserve"`が有効でなければならない(MUST)。`bun run typecheck:tsc`は、
ルートプロジェクトに加えて`apps/examples/tsconfig.json`に対しても`tsc --noEmit`を
実行し、型エラーまたは未使用の`@ts-expect-error`があれば非ゼロ終了しなければ
ならない(MUST)。

#### Scenario: 既存の authored .jsx が型エラーなく通る
- **WHEN** `bun run typecheck:tsc`を実行する
- **THEN** `apps/examples/**/*.jsx`と`types/test/**/*.jsx`で、抑制対象として明示した
  失敗例を除き型エラーが報告されない

#### Scenario: 存在しないグローバル関数を呼ぶと型エラーになる
- **WHEN** authored `.jsx`内で未宣言のグローバル関数(例:
  `signal`/`derived`/`render`のいずれでもない不明な識別子)を呼び出す
- **THEN** `tsc --noEmit`は型エラーを報告する

### Requirement: signal/derived/render のグローバル型宣言
`signal`・`derived`・`render`は`types/jsx.d.ts`でグローバル関数として型宣言されなければならない(MUST)。authored `.jsx`からimportなしで型付きで呼び出せなければならない(MUST)。`signal<T>(initial: T)`は読み取り、値設定、関数形式設定(`(): T`、`(next: T): T`、`(updater: (previous: T) => T): T`)を提供しなければならない(SHALL)。二引数signalと`collection`は宣言してはならない(SHALL NOT)。`derived<T>(compute: () => T)`は`() => T`を返す SHALL。`render(element: JSX.Element): void`はJSX式を1つ受け取る SHALL。

#### Scenario: signal の読み書き両方の呼び出し形が型付けされる
- **WHEN** `const count = signal(0)`のあと`count()`と`count(1)`の両方を呼ぶ
- **THEN** どちらも型エラーにならず、`count()`の返り値型は`number`と推論される

#### Scenario: signal の初期値と異なる型を書き込むと型エラーになる
- **WHEN** `const count = signal(0)`のあと`count('x')`を呼ぶ
- **THEN** `tsc --noEmit`は型エラーを報告する

#### Scenario: キー付きsignalの項目更新が型付けされる
- **WHEN** `count((previous) => previous + 1)`を呼ぶ
- **THEN** 引数と返り値がsignal値の型として検査される

### Requirement: JSX intrinsic 要素の型宣言
`types/jsx.d.ts`はグローバル`JSX.IntrinsicElements`を宣言しなければ
ならない(MUST)。DOMの`HTMLElementTagNameMap`に存在するタグ名のみを
許可する SHALL。存在しないタグ名は型エラーにしなければならない(MUST)。
各intrinsic要素は共通属性として`key`、`use`、`onXxx`パターンのイベント処理属性、
`children`を受け付ける SHALL。それ以外の属性名は緩い`string`キーで許容する SHALL。
`onClick`/`onDblClick`は`MouseEvent`、`onKeyDown`は`KeyboardEvent`、`onInput`は
`InputEvent`、`onChange`は`Event`、`onBlur`は`FocusEvent`として引数を型付けし、
`currentTarget`を属性が書かれたHTML要素型へ絞らなければならない(MUST)。
`target`はイベント発生元が子要素の場合を考慮し、DOM標準の型を維持する SHALL。

#### Scenario: 存在するタグ名は型エラーにならない
- **WHEN** `<div>`・`<p>`・`<button>`・`<input>`・`<ul>`・`<li>`・`<span>`の
  いずれかを使う
- **THEN** タグ名に起因する型エラーは発生しない

#### Scenario: 存在しないタグ名は型エラーになる
- **WHEN** `HTMLElementTagNameMap`に存在しないタグ名を使う
- **THEN** `tsc --noEmit`は型エラーを報告する

#### Scenario: onXxx ハンドラ属性が型付けされる
- **WHEN** `<button onClick={() => {}}>`のように`onXxx`パターンの属性へ関数を渡す
- **THEN** 型エラーにならない

#### Scenario: 入力要素のキーイベントを絞り込む
- **WHEN** `<input onKeyDown={(event) => ...}>`でイベント引数を参照する
- **THEN** `event`は`KeyboardEvent`として、`event.currentTarget`は
  `HTMLInputElement`として型検査される

#### Scenario: ボタンのクリックイベントを絞り込む
- **WHEN** `<button onClick={(event) => ...}>`でイベント引数を参照する
- **THEN** `event`は`MouseEvent`として、`event.currentTarget`は
  `HTMLButtonElement`として型検査される

#### Scenario: 任意のイベント処理属性を維持する
- **WHEN** 既知の6属性以外の`onXxx`属性へ関数を渡す
- **THEN** 属性名を理由に型エラーを報告せず、関数以外の値は型エラーにする

#### Scenario: use 属性が型付けされる
- **WHEN** `<input use={(el) => { /* ... */ }}>`のように要素を受け取る
  関数、要素を受け取り引数なしの再描画関数を返す関数、または
  `{ update?, destroy? }`を返す関数を`use`へ渡す
- **THEN** いずれの形も型エラーにならない

### Requirement: 型検査は実行時 scope limit の代替ではない
`types/jsx.d.ts`が特定の構文(例: リストアイテム内の`use=`)を型上
許可していても、それは実行時のコンパイラによる別の`scope limit`検査を免れることを
意味してはならない(MUST NOT)。構造unit内の`use=`は現在受理されるが、字句スコープ外の
signal参照や未対応のaction形などは引き続き拒否される。この非対称性はdesign.mdおよび
コード内コメントに明記しなければならない(MUST)。

#### Scenario: useの型検査と実行時受理は別の検査である
- **WHEN** リストアイテム内の要素に`use=`属性を書く
- **THEN** `tsc --noEmit`は型エラーを報告せず、`compile()`は構造unit actionの
  受理条件を検査する。構造unit内の`use=`自体は受理されるが、型宣言はscope limit
  検査の代替ではない

### Requirement: コンポーネントのプロパティ形状を検査する
authored `.jsx`のコンポーネントは、分割代入引数へJSDocでプロパティ形状を宣言した場合、
同一ファイルと相対importの呼び出し箇所で必須プロパティ、プロパティ名、値の型を
検査できなければならない(MUST)。型宣言を実行時オブジェクトや生成コードへ残しては
ならない(MUST NOT)。

#### Scenario: 宣言と一致するプロパティを受理する
- **WHEN** JSDocで宣言した必須プロパティを正しい名前と型でコンポーネントへ渡す
- **THEN** `tsc --noEmit`は同一ファイルと相対importのどちらでも型エラーを報告しない

#### Scenario: 必須プロパティの欠落を拒否する
- **WHEN** JSDocで宣言した必須プロパティを呼び出し箇所で省略する
- **THEN** `tsc --noEmit`は型エラーを報告する

#### Scenario: 不明なプロパティまたは値型を拒否する
- **WHEN** 宣言にないプロパティを渡すか、宣言と異なる型の値を渡す
- **THEN** `tsc --noEmit`は型エラーを報告する
