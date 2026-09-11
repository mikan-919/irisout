## MODIFIED Requirements

### Requirement: signal/derived/render のグローバル型宣言
`signal`・`derived`・`render`は`types/jsx.d.ts`でグローバル関数として型宣言されなければならない(MUST)。authored `.jsx`からimportなしで型付きで呼び出せなければならない(MUST)。`signal<T>(initial: T)`は読み書き両用の関数(`(): T`と`(next: T): T`の両方の呼び出し形)を返す SHALL。`signal<T, K>(initial: readonly T[], keyOf: (item: T) => K)`は配列の読み書きに加え、`update(key: K, updater: (current: T) => T): T`を持つ関数を返す SHALL。`collection`は宣言してはならない(SHALL NOT)。`derived<T>(compute: () => T)`は`() => T`を返す SHALL。`render(element: JSX.Element): void`はJSX式を1つ受け取る SHALL。

#### Scenario: signal の読み書き両方の呼び出し形が型付けされる
- **WHEN** `const count = signal(0)`のあと`count()`と`count(1)`の両方を呼ぶ
- **THEN** どちらも型エラーにならず、`count()`の返り値型は`number`と推論される

#### Scenario: signal の初期値と異なる型を書き込むと型エラーになる
- **WHEN** `const count = signal(0)`のあと`count('x')`を呼ぶ
- **THEN** `tsc --noEmit`は型エラーを報告する

#### Scenario: キー付きsignalの項目更新が型付けされる
- **WHEN** `signal(items, (item) => item.id)`の返り値で`update(id, updater)`を呼ぶ
- **THEN** キーと項目の型が推論され、異なる型は型エラーになる
