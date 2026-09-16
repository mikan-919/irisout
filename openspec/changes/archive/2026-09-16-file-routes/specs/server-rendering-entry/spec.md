## MODIFIED Requirements

### Requirement: SSR入口の明示指定

公開パッケージは`irisout/ssr`と`irisoutSsr()`を提供し、指定したルート部品一つの初期描画全体をSSRしなければならない(SHALL)。部品単位のSSR指定とSSR可能性の自動判定を行ってはならない(SHALL NOT)。ファイル経路を使う場合は`irisout/hono`のサブルーターが`page.jsx`ごとのSSR生成物を明示的に対応付けなければならない(SHALL)。

#### Scenario: 指定したルートだけをSSRする

- **WHEN** Vite+へ`irisoutSsr({ entry })`を登録してサーバー生成物を作る
- **THEN** 指定したルート部品の初期描画全体をSSRし、client入口へ要求単位のSSRを混ぜない

#### Scenario: ファイル経路のpageをSSRする

- **WHEN** `page.jsx`から生成したHonoサブルーターへ`/users/123`を要求する
- **THEN** `/users/:id`に対応するpageだけを要求単位でSSRする

### Requirement: HTMLとhydrate state

SSR入口の`render(input)`は`{ html, state }`を返さなければならない(SHALL)。`input`と`state`はJSONへ直列化できる値だけを含み、stateは対応するブラウザ生成物へ渡して既存HTMLのhydrateに使える形でなければならない(SHALL)。局所signalの初期値はstateへ含め、hydrate時に再評価してはならない(SHALL)。公開された`serializeSsrState()`はstateをscript要素へ安全に埋め込めるJSON文字列へ変換しなければならない(SHALL)。

SSR生成物の`hydrateComponent(container, state)`と`mountComponent(container, state)`のstate引数は`render(input)`が返したstate専用でなければならず(SHALL)、raw inputを受け付けてはならない(SHALL NOT)。入力に`__irisout_state__`というpropertyがあっても、stateの`input` propertyを通してcomponentへ渡さなければならない(SHALL)。ファイル経路のHTML文書の外枠は利用側が組み立て、遷移応答は対応するpageのHTMLとstateを返さなければならない(SHALL)。

#### Scenario: renderのstateでhydrateする

- **WHEN**`render(input)`の返値を`hydrateComponent(container, state)`へ渡す
- **THEN** 初期HTMLを再生成せず、stateの入力と局所signalを使って既存DOMへ接続する

#### Scenario: 直接アクセスのpage応答

- **WHEN** loaderを実行したpageへ直接HTTP要求する
- **THEN** 利用側が文書外枠へ埋め込めるHTMLと対応するstateを得る

### Requirement: SSR入力のJSON境界

SSR入力とstateは、配列、`null` prototypeまたは`Object.prototype`のobject、有限number、string、boolean、`null`だけを含まなければならない(SHALL)。`Map`、`Set`、`Date`、`toJSON`、関数、symbol、循環参照、accessor propertyを受け付けてはならない(SHALL NOT)。loaderの結果も同じJSON境界を通過しなければならない(SHALL)。

#### Scenario: 不正なSSR入力を拒否する

- **WHEN** 循環参照、有限でないnumber、またはloaderからDateを`render(input)`へ渡す
- **THEN** SSR入力の診断で拒否し、正常なHTMLまたはstateを返さない

### Requirement: 初期SSRの対応記法

初期SSRは入力、テキスト、属性、条件分岐、一覧、ルート部品直下の局所signalを処理しなければならない(SHALL)。構造unit内の`signal()`または`derived()`は拒否しなければならない(SHALL NOT)。要求ごとに生成した局所signalを別の要求から読んではならない(SHALL)。

#### Scenario: 要求ごとに初期値を分離する

- **WHEN** 異なる入力を同時に`render(input)`へ渡す
- **THEN** 各HTMLとstateは自分の入力と局所signalだけを含む

### Requirement: SSRで実行しない処理

SSRはイベント処理、`onMount`、`effect`、`use=`を実行してはならない(SHALL NOT)。module共有状態、外部moduleの任意実行、対応外記法は`compile:` scope limit診断で拒否しなければならない(SHALL)。相対moduleは関数宣言だけの場合も含め、初期SSRでは拒否しなければならない(SHALL)。404・503の応答で正常ページ用stateを生成しないことは、要求処理層の契約であり、この入口の受入条件には含めない。ファイル経路のloader実装、要求オブジェクト、接続情報をブラウザー応答へ含めてはならない(SHALL NOT)。

#### Scenario: クライアント専用処理をSSRしない

- **WHEN** ルート部品にイベント、`onMount`、`effect`、`use=`を含めてSSRする
- **THEN** 初期HTMLは生成するが、それらの処理はサーバーで実行しない

#### Scenario: loaderの失敗情報を隠す

- **WHEN** page loaderが要求情報を含む例外を投げる
- **THEN** 正常page stateと内部例外文を返さず、限定したserver error応答にする

## ADDED Requirements

### Requirement: ファイル経路の要求処理

ファイル経路のサブルーターはpageごとに任意の非同期loaderを対応付け、loaderへ復号済み経路引数、`URLSearchParams`形式の検索引数、要求情報を渡さなければならない(SHALL)。loaderの通常結果をpageの`render(input)`へ渡し、loaderのないpageは空の入力で描画しなければならない(SHALL)。loaderの実装、要求情報、接続情報をHTMLまたは遷移用JSONへ搬送してはならない(SHALL NOT)。

#### Scenario: 経路引数と検索引数をloaderへ渡す

- **WHEN** `/users/123?tab=posts`を要求する
- **THEN** 対応loaderが`params.id === '123'`と`search.get('tab') === 'posts'`を受け、結果がpage入力になる

#### Scenario: loaderなしpageを描画する

- **WHEN** loaderを登録していないpageへ要求する
- **THEN** pageはloader実行なしでSSRされる

### Requirement: not-found、redirect、errorの応答

loaderは未検出と転送を返せなければならず(SHALL)。直接要求では未検出を404、転送を指定locationのHTTP redirectとして返し、遷移用要求では同じ種別をJSON応答として返さなければならない(SHALL)。loaderまたはSSRが例外を投げた場合、直接要求と遷移用要求は500相当の限定応答にし、正常page用HTML、state、サーバー内部情報を返してはならない(SHALL NOT)。

#### Scenario: loaderの未検出と転送

- **WHEN** loaderが未検出または`/login`への転送を返す
- **THEN** 直接要求はそれぞれ404またはredirectとなり、遷移用要求も正常pageではない同じ結果になる

#### Scenario: loader例外を限定する

- **WHEN** loaderが内部接続情報を含む例外を投げる
- **THEN** 500応答を返し、正常page stateと例外文を含めない
