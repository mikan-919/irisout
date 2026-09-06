# multi-file-module-composition

## Purpose

入口moduleから相対importした小規模な`.js`/`.jsx` moduleを、実行時component
runtimeなしで一つの生成moduleへ合成する。コンポーネントはコンパイル時に消え、
通常の補助関数と不変定数は必要なJavaScriptとして残る。

## Requirements

### Requirement: 相対moduleの静的解決

`compileProject(entryPath)`は入口から辿れる`./`または`../`の静的importを解決し、
`.js`/`.jsx`のmoduleを依存順にリンクしなければならない(SHALL)。

#### Scenario: 別ファイルcomponentをJSXで使う

- **WHEN** entryが`import { Child } from './Child.jsx'`を持ち、JSXで`<Child />`を使う
- **THEN** compileProjectは成功し、生成moduleに`Child`の実行時呼び出しを残さない

#### Scenario: 複数段の相対import

- **WHEN** entryがcomponentをimportし、そのcomponentが`../lib/format.js`をimportする
- **THEN** 両方のmoduleが解決され、初期HTMLとmount後のDOMが生成できる

### Requirement: helperとimmutable constの利用

リンクしたmoduleの通常のfunction declarationと単純な`const`を、JSX式、derived、
handler、component propsの実引数から利用できなければならない(SHALL)。補助宣言は
生成moduleの通常のJavaScriptとして一度だけ出力しなければならない(SHALL)。

#### Scenario: imported helperが複数のauthoring位置で動く

- **WHEN** helper functionとconstantを別moduleからimportし、JSX式、derived、handler、
  propsの実引数で利用する
- **THEN** build-time executionが初期値を計算し、生成moduleのevent後DOMもhelperの
  結果を使う

### Requirement: componentのコンパイル時消滅

リンクしたcomponentは既存のASTインライン化で処理し、生成moduleへcomponent function、
props object、汎用component runtimeを出力してはならない(SHALL NOT)。

#### Scenario: component境界を生成物へ残さない

- **WHEN** entryが別moduleのcomponentをJSXで参照する
- **THEN** component functionの実行時呼び出しとcomponent runtimeを含まない生成moduleを出力する

### Requirement: 既存単一file APIの互換性

既存の`compile(source)`は引き続き単一sourceを受理し、既存の単一file fixtureと
テストを壊してはならない(SHALL)。module解決は`compileProject`へ分離する。

#### Scenario: compile(source)のimport境界

- **WHEN** 呼び出し側が単一sourceの`compile(source)`へimport文を渡す
- **THEN** 既存の単一file APIはmodule解決を行わず、`compile:`エラーを返す

### Requirement: 未対応module機能の明示拒否

外部specifier、未解決path、dynamic import、namespace/side-effect import、re-export、
循環依存、トップレベル副作用、トップレベルの`collection` stateは`compile:`で始まるエラーを
返さなければならない(SHALL)。黙って無視してはならない(SHALL NOT)。

#### Scenario: 未対応module構文を拒否する

- **WHEN** module graphに外部import、dynamic import、re-export、循環依存、または
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

### Requirement: Vite通常経路

`apps/examples`の通常buildは入口pathをcompilerへ渡し、複数module fixtureの初期HTMLと
hydrate用JavaScriptを生成しなければならない(SHALL)。生成物には`signal(`、`derived(`、
component functionの実行時呼び出しを含めてはならない(SHALL NOT)。

#### Scenario: 分割fixtureをVite buildする

- **WHEN** `IRISOUT_ENTRY`へ複数module fixtureのentry pathを設定してexamplesをbuildする
- **THEN** `index.html`へ初期HTML、`app.js`へhydrate codeが出力され、component functionと
  build-time用state wrapperは出力されない
