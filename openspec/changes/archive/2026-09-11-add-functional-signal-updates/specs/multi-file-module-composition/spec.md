## MODIFIED Requirements

### Requirement: 未対応module機能の明示拒否
外部specifier、未解決path、dynamic import、namespace/side-effect import、re-export、循環依存、トップレベル副作用、直接形でないトップレベルのstateは`compile:`で始まるエラーを返さなければならない(SHALL)。黙って無視してはならない(SHALL NOT)。

#### Scenario: 未対応module構文を拒否する
- **WHEN** module graphに外部import、dynamic import、re-export、循環依存、または二引数のmodule scope signalが含まれる
- **THEN** compileProjectは生成物を作らず、原因を示す`compile:`エラーを返す

#### Scenario: module共有signalを受理する
- **WHEN** module graphに単純な`const count = signal(initial)`が含まれ、componentがcountを読む
- **THEN** compileProjectはそのsignalをmodule共有cellとして一度だけ生成し、component instanceごとの更新購読を出力する

#### Scenario: module共有derivedを受理する
- **WHEN** module graphに`const doubled = derived(() => count() * 2)`が含まれ、componentが`doubled()`を読む
- **THEN** compileProjectはderived関数をmodule scopeへ一度だけ生成し、`count`の更新時に既存のcomponent instance更新経路から値を再評価する

#### Scenario: module共有collectionを受理する
- **WHEN** module graphに配列を初期値とする一引数signalが含まれ、componentがそのbindingを読む
- **THEN** compileProjectは通常の共有signalをmodule scopeへ一度だけ生成し、各component instanceのList更新経路を購読させる
