## MODIFIED Requirements

### Requirement: 未対応module機能の明示拒否

外部specifier、未解決path、dynamic import、namespace/side-effect import、re-export、
循環依存、トップレベル副作用、直接形でないトップレベルの`collection` stateは`compile:`で
始まるエラーを返さなければならない(SHALL)。直接形のmodule共有collectionは受理し、黙って
無視してはならない(SHALL NOT)。

#### Scenario: module共有collectionを受理する

- **WHEN** module graphに`const items = collection(initial, (item) => item.id)`が含まれ、componentが
  `items().map(...)`を読む
- **THEN** compileProjectはcollection accessorをmodule scopeへ一度だけ生成し、各component
  instanceのList更新経路を購読させる

#### Scenario: 直接形でないmodule collectionを拒否する

- **WHEN** module graphにblock key selectorを持つmodule scopeの`collection` stateが含まれる
- **THEN** compileProjectは生成物を作らず、原因を示す`compile:`エラーを返す

#### Scenario: 未対応module構文を拒否する

- **WHEN** module graphに外部import、dynamic import、re-export、循環依存、または直接形でない
  module scopeの`collection` stateが含まれる
- **THEN** compileProjectは生成物を作らず、原因を示す`compile:`エラーを返す

#### Scenario: module共有signalを受理する

- **WHEN** module graphに単純な`const count = signal(initial)`が含まれ、componentがcountを読む
- **THEN** compileProjectはそのsignalをmodule共有cellとして一度だけ生成し、component instance
  ごとの更新購読を出力する

#### Scenario: module共有derivedを受理する

- **WHEN** module graphに`const doubled = derived(() => count() * 2)`が含まれ、componentが
  `doubled()`を読む
- **THEN** compileProjectはderived関数をmodule scopeへ一度だけ生成し、`count`の更新時に
  既存のcomponent instance更新経路から値を再評価する
