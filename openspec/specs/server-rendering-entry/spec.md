## Purpose

運営側が指定したIrisoutのルート部品を要求ごとに描画し、HTMLとJSON直列化可能なstateを
ブラウザへ渡して、既存DOMへhydrateできるサーバー用入口を定める。

## Requirements

### Requirement: SSR入口の明示指定

公開パッケージは`irisout/ssr`と`irisoutSsr()`を提供し、指定したルート部品一つの初期描画全体を
SSRしなければならない(SHALL)。部品単位のSSR指定とSSR可能性の自動判定を行ってはならない
(SHALL NOT)。

#### Scenario: 指定したルートだけをSSRする

- **WHEN** Vite+へ`irisoutSsr({ entry })`を登録してサーバー生成物を作る
- **THEN** 指定したルート部品の初期描画全体をSSRし、client入口へ要求単位のSSRを混ぜない

### Requirement: HTMLとhydrate state

SSR入口の`render(input)`は`{ html, state }`を返さなければならない(SHALL)。`input`と`state`
はJSONへ直列化できる値だけを含み、stateは対応するブラウザ生成物へ渡して既存HTMLのhydrateに
使える形でなければならない(SHALL)。局所signalの初期値はstateへ含め、hydrate時に再評価しては
ならない(SHALL)。公開された`serializeSsrState()`はstateをscript要素へ安全に埋め込めるJSON文字列へ
変換しなければならない(SHALL)。

SSR生成物の`hydrateComponent(container, state)`と`mountComponent(container, state)`のstate引数は
`render(input)`が返したstate専用でなければならず(SHALL)、raw inputを受け付けてはならない(SHALL NOT)。
入力に`__irisout_state__`というpropertyがあっても、stateの`input` propertyを通してcomponentへ
渡さなければならない(SHALL)。

#### Scenario: renderのstateでhydrateする

- **WHEN** `render(input)`の返値を`hydrateComponent(container, state)`へ渡す
- **THEN** 初期HTMLを再生成せず、stateの入力と局所signalを使って既存DOMへ接続する

ルート入力のbindingが生成moduleの内部名と衝突する場合、SSR入口は`compile:` scope limit診断を
返さなければならない(SHALL)。

### Requirement: SSR入力のJSON境界

SSR入力とstateは、配列、`null` prototypeまたは`Object.prototype`のobject、有限number、string、
boolean、`null`だけを含まなければならない(SHALL)。`Map`、`Set`、`Date`、`toJSON`、関数、symbol、
循環参照、accessor propertyを受け付けてはならない(SHALL NOT)。

#### Scenario: 不正なSSR入力を拒否する

- **WHEN** 循環参照または有限でないnumberを`render(input)`へ渡す
- **THEN** SSR入力の診断で拒否し、正常なHTMLまたはstateを返さない

### Requirement: 初期SSRの対応記法

初期SSRは入力、テキスト、属性、条件分岐、一覧、ルート部品直下の局所signalを処理しなければ
ならない(SHALL)。構造unit内の`signal()`または`derived()`は拒否しなければならない(SHALL NOT)。
要求ごとに生成した局所signalを別の要求から読んではならない(SHALL)。

#### Scenario: 要求ごとに初期値を分離する

- **WHEN** 異なる入力を同時に`render(input)`へ渡す
- **THEN** 各HTMLとstateは自分の入力と局所signalだけを含む

### Requirement: SSRで実行しない処理

SSRはイベント処理、`onMount`、`effect`、`use=`を実行してはならない(SHALL NOT)。module共有状態、
外部moduleの任意実行、対応外記法は`compile:` scope limit診断で拒否しなければならない(SHALL)。
相対moduleは関数宣言だけの場合も含め、初期SSRでは拒否しなければならない(SHALL)。404・503の
応答で正常ページ用stateを生成しないことは、要求処理層の契約であり、
この入口の受入条件には含めない。

#### Scenario: クライアント専用処理をSSRしない

- **WHEN** ルート部品にイベント、`onMount`、`effect`、`use=`を含めてSSRする
- **THEN** 初期HTMLは生成するが、それらの処理はサーバーで実行しない
