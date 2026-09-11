## MODIFIED Requirements

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
