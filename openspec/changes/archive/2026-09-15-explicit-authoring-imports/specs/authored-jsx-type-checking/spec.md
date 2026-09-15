## MODIFIED Requirements

### Requirement: signal/derived/render は irisout から明示的にimportする
`signal`・`derived`・`render`は`irisout`の公開型宣言として名前付きimportで提供されなければならない(MUST)。authored `.jsx`は明示的にimportして型付きで呼び出さなければならず、`types/jsx.d.ts`はこれらを大域関数として宣言してはならない(SHALL NOT)。コンパイラはimportを生成物の実行時依存にしてはならず、生成前に取り除かなければならない(SHALL)。

#### Scenario: authoring API をimportなしで呼ぶと型エラーになる
- **WHEN** authored `.jsx`で`signal(0)`または`render(<div />)`をimportなしで呼ぶ
- **THEN** `tsc --noEmit`は未宣言の識別子として型エラーを報告する
