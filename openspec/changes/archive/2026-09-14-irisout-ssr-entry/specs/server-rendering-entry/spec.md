## Purpose

運営側が指定したIrisoutのルート部品を要求ごとに描画し、HTMLとJSON直列化可能なstateをブラウザへ渡して、既存DOMへhydrateできるサーバー用入口を提供する。

## ADDED Requirements

### Requirement: SSR入口の明示指定

公開パッケージは`irisout/ssr`と`irisoutSsr()`を提供し、利用者が指定したルート部品一つの初期描画全体をSSRしなければならない(SHALL)。部品単位のSSR指定とSSR可能性の自動判定を行ってはならない(SHALL NOT)。

#### Scenario: ルート部品のSSR

- **WHEN** Vite+設定で`irisoutSsr()`へルート部品を指定して構築する
- **THEN** 指定したルートの初期描画全体を要求時に呼び出せるSSR入口が生成される

### Requirement: HTMLとhydrate state

SSR入口の`render(input)`は`{ html, state }`を返さなければならず(SHALL)、`input`と`state`はJSONへ直列化できる値だけを含まなければならない(SHALL)。stateは対応するブラウザ生成物へ渡して既存HTMLのhydrateに使える形でなければならない(SHALL)。局所signalの初期値はstateへ含め、hydrate時に再評価してはならない(SHALL)。公開された`serializeSsrState()`はstateをscript要素へ安全に埋め込めるJSON文字列へ変換しなければならない(SHALL)。

SSR生成物の`hydrateComponent(container, state)`と`mountComponent(container, state)`のstate引数は`render(input)`が返したstate専用でなければならず(SHALL)、raw inputを受け付けてはならない(SHALL NOT)。入力に`__irisout_state__`というpropertyがあっても、stateの`input` propertyを通してcomponentへ渡さなければならない(SHALL)。

ルート入力のbindingが生成moduleの内部名と衝突する場合、SSR入口は`compile:` scope limit診断を返さなければならない(SHALL)。

#### Scenario: HTMLとstateの生成

- **WHEN** JSONへ直列化できる入力を`render(input)`へ渡す
- **THEN** 初期HTMLと局所signalを含むstateが返り、`serializeSsrState()`でscript要素へ埋め込める文字列へ変換できる

### Requirement: SSR入力のJSON境界

SSR入力とstateは、配列、`null` prototypeまたは`Object.prototype`のobject、有限number、string、boolean、`null`だけを含まなければならない(SHALL)。`Map`、`Set`、`Date`、`toJSON`、関数、symbol、循環参照、accessor propertyを受け付けてはならない(SHALL NOT)。

#### Scenario: 初期HTMLの引継ぎ

- **WHEN** 同じ入力で`render(input)`の結果をHTMLへ埋め込み、ブラウザ用生成物をhydrateする
- **THEN** 初期HTMLを再生成せず、入力と局所stateを使って既存DOMへ接続できる

#### Scenario: 生成内部名との衝突

- **WHEN** ルートcomponentの入力bindingが`__input__`、`__rawInput__`、`__state__`、`__signal_state__`などの生成内部名と一致する
- **THEN** SSR入口は`compile:` scope limit診断を返す

### Requirement: 初期SSRの対応記法

初期SSRは入力、テキスト、属性、条件分岐、一覧、ルート部品直下の局所signalを処理しなければならない(SHALL)。構造unit内の`signal()`または`derived()`は拒否しなければならない(SHALL NOT)。

#### Scenario: 対応記法の描画

- **WHEN** 固定ページが入力値、テキスト、属性、条件分岐、一覧、ルート部品直下の局所signalを使う
- **THEN** 入力ごとに異なるHTMLとhydrate stateが生成される

### Requirement: SSRで実行しない処理

SSRはイベント処理、`onMount`、`effect`、`use=`を実行してはならず(SHALL NOT)、module共有状態を使う入力を診断で拒否しなければならない(SHALL)。相対moduleは関数宣言だけの場合も含め、初期SSRでは拒否しなければならない(SHALL)。404・503の応答で正常ページ用stateを生成しないことは、要求処理層の契約であり、この入口の受入条件には含めない。

#### Scenario: クライアント専用処理

- **WHEN** ルート部品がイベント、`onMount`、`effect`、`use=`を含む
- **THEN** SSR中に副作用を起こさず、クライアント接続用の処理としてだけ扱う

#### Scenario: module共有状態

- **WHEN** ルート部品がmodule scopeの共有signalまたはderivedを読む
- **THEN** 要求間共有を許可せず、`compile:` scope limit診断を返す

#### Scenario: 相対module

- **WHEN** SSR入口が相対moduleの関数宣言または補助bindingをimportする
- **THEN** 単一ファイル入口に限定し、`compile:` scope limit診断を返す

#### Scenario: 構造unit内の状態

- **WHEN** 条件分岐または一覧の内部componentが`signal()`または`derived()`を宣言する
- **THEN** 初期SSRで実行せず、`compile:` scope limit診断を返す

#### Scenario: 要求層の異常応答

- **WHEN** 要求が404または503になる
- **THEN** 正常ページ用のHTMLとstateを生成しない。この判定はSSR入口ではなく要求処理層で行う
