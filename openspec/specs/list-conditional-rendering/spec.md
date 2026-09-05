# list-conditional-rendering

## Purpose

リスト(`.map()`)・条件分岐(三項式・`&&`)を、ADR-0005が決定した
factory-per-unitクロージャで生成する(M5、change
`m5-list-conditional-factory-closures`)。`<template>`+`cloneNode(true)`の
スタンプ機構、アイテム/ブランチごとの1関数(クローン取得・ローカル状態・
`update_*`・`addEventListener`登録)、リスト更新のkeyed reuseを規定する。
リストアイテム内・条件分岐ブランチ内にさらにリスト/条件分岐がネストする
従来スコープ外だった形は、各構造ユニットを専用factoryで再帰的に生成することで
任意の深さを受理する(change `recursive-structural-authoring`)。各factory instance
は自身のDOM範囲、ローカル状態、binding cache、更新処理を所有する。
## Requirements
### Requirement: templateスタンプ機構によるインスタンス生成
コンパイラは、リストアイテム・条件分岐ブランチの中身を`<template>`要素として
1回だけ生成し、インスタンスごとに`content.cloneNode(true)`で複製しなければ
ならない(SHALL)。文字列HTML生成(`insertAfter`/`createContextualFragment`)
は使わない。クローンした実要素は、ラッパー要素を挟まず親の直接の子と
なる。

#### Scenario: リストアイテムのスタンプ
- **WHEN** リストの新規keyに対応するアイテムが必要になる
- **THEN** コンパイラが生成したコードは`<template>`のcloneNodeで実要素を
  生成し、ラッパー要素なしで親(例: `<ul>`)の子として挿入する

### Requirement: アイテム/ブランチごとのfactory関数生成
コンパイラは、リストアイテムテンプレート・条件分岐の各ブランチについて、
以下を1つの関数にまとめて生成しなければならない(SHALL): テンプレート
クローンとマーカー要素の取得、インスタンス固有のローカル状態(素の変数、
`signal()`ラッパーなし)、そのインスタンスの`update_*`関数、そのインスタンス
のイベントハンドラ登録(直接`addEventListener`)。

#### Scenario: リストアイテムのfactory関数
- **WHEN** リストアイテムがマウントされる
- **THEN** 生成されたfactory関数が呼び出され、そのアイテム専用のDOM
  部分木・ローカル状態・updateロジック・イベントリスナーを持つハンドルを
  返す

#### Scenario: 条件分岐ブランチのfactory関数
- **WHEN** 条件分岐の特定ブランチが真になり描画が必要になる
- **THEN** そのブランチに対応する生成されたfactory関数が呼び出され、
  同様の構造を持つハンドルを返す

### Requirement: リスト更新はkeyed reuse
コンパイラが生成する`update_<list>()`は、既存keyについてはfactory関数が
返したハンドル(DOM要素・ローカル状態への参照)をそのまま再利用し、DOM
再生成やイベントリスナーの貼り直しを行ってはならない(SHALL NOT)。新規key
のみfactory関数を新規呼び出しする。

#### Scenario: 既存keyの更新
- **WHEN** リストのデータが更新されるが、あるアイテムのkeyが更新前後で
  変わらない
- **THEN** そのアイテムのDOM要素・ローカル状態・イベントリスナーは
  再生成されず、値の差分のみが反映される

#### Scenario: 新規keyの追加
- **WHEN** リストのデータに新しいkeyのアイテムが加わる
- **THEN** そのkeyに対応するfactory関数が新規に呼び出され、新しいハンドルが
  keyed Mapに登録される

### Requirement: 配列脱落とフィルタ除外の区別
コンパイラが生成する`update_<list>()`は、元データ配列そのものからkeyが
消えた場合にのみ、keyed Mapからエントリを破棄し対応するDOM要素を
`remove()`しなければならない(SHALL)。フィルタ処理などにより可視集合
からは除外されるがデータ配列には残っているkeyについては、そのリスト
自身がDOM上にマウントされ続けている限り、Mapのエントリ・ローカル状態を
保持したままにしなければならない(SHALL)。ただし、そのリストが条件分岐
ブランチにネストしており、外側の条件分岐が選択を切り替えて
リスト全体を非マウントにした場合は、内側リストのkeyed Map・ローカル状態
は全件破棄されてよい(MAY) ― これは外側条件分岐の「破棄して作り直す」
ライフサイクル(下記「ネストした構造ユニットのライフサイクル」要件)の
自然な帰結であり、フィルタ除外時の保持保証はリストが非マウントになる
瞬間には及ばない。

#### Scenario: データ配列からの削除
- **WHEN** アイテムが元データ配列(例: `todos()`)から削除される
- **THEN** 対応するkeyed Mapのエントリが破棄され、DOM要素が`remove()`
  される

#### Scenario: フィルタによる可視集合からの除外(リストがマウントされたまま)
- **WHEN** アイテムは元データ配列には残ったまま、フィルタ後の可視集合
  からのみ外れ、リスト自身は(他のアイテムが可視のため)引き続き
  マウントされている
- **THEN** 対応するkeyed Mapのエントリ・ローカル状態は保持される
  (破棄されない)

#### Scenario: 外側条件分岐によるリスト全体の非マウント
- **WHEN** リストが条件分岐ブランチにネストしており、可視集合が全件0に
  なったことで外側の条件分岐がリストを非選択(非マウント)にする
- **THEN** 内側リストのkeyed Mapの全エントリ(フィルタで非可視だった
  アイテムを含む)が破棄されてよく、これは仕様違反とみなさない

### Requirement: アイテム/ブランチの明示的teardownは行わない
コンパイラが生成するコードは、リストアイテム・条件分岐ブランチが破棄
される際に、専用のteardown関数呼び出しを生成してはならない(SHALL NOT)。
keyed Mapから参照が落ち、DOM要素が`remove()`されれば、状態・リスナー・
DOM部分木はGC対象になる。

#### Scenario: アイテム削除時のteardown不在
- **WHEN** リストアイテムがkeyed Mapから破棄される
- **THEN** 生成されたコードは明示的なteardown関数を呼び出さず、DOM要素の
  `remove()`のみを行う

### Requirement: ネストした構造ユニットの再帰生成
コンパイラは、リストアイテム・条件分岐ブランチ内の構造ユニットを、深さを
固定値で制限せず再帰的に受理しなければならない(SHALL)。構造ユニットの
instanceごとにDOM範囲、ローカル状態、binding cache、更新処理を分離し、
内側unitの更新を所有者factoryへ接続しなければならない(SHALL)。

#### Scenario: リストアイテム内の条件分岐の受理
- **WHEN** authored コンポーネントのリストアイテムテンプレート内に条件
  分岐(例: 編集モードのspan/input切り替え)がある
- **THEN** コンパイラはリストアイテムのfactory関数の中に、条件分岐用の
  factory関数・update関数を生成し、itemごとに条件分岐の状態を分離する

#### Scenario: 条件分岐ブランチ内のリストの受理
- **WHEN** authored コンポーネントの条件分岐ブランチ内にリスト
  (`.map()`によるJSX生成)がある
- **THEN** コンパイラは条件分岐ブランチのfactory関数の中に、リスト用の
  factory関数・update関数(keyed reuse含む)を入れ子に生成する

#### Scenario: 3階層以上のネストの受理
- **WHEN** リストアイテム、条件分岐、内側リストのように3階層以上の構造
  ユニットが連続する
- **THEN** コンパイラは深さを理由に`scope limit`で拒否せず、各unitのfactoryを
  親factoryの字句スコープへ生成し、mount・切り替え・更新・再生成を完了する

### Requirement: ネストした構造ユニットのfactory生成
コンパイラは、リストアイテム・条件分岐ブランチの本体の中にネストした
構造ユニットがある場合、そのネストした構造ユニット用のfactory関数・
update関数を、外側の構造ユニットのfactory関数のローカルスコープの中に
再帰的に生成しなければならない(SHALL)。トップレベルの構造ユニットに
対して行う生成(スタンプ機構・factory関数・keyed reuse)と同じ規則を、
ネストした構造ユニットに対しても適用する。内側unitの条件式・配列式が
祖先unitのローカルsignalを読む場合は、祖先factoryの更新から内側factoryの
更新へ接続しなければならない。

#### Scenario: リストアイテム内の条件分岐のfactory生成
- **WHEN** リストアイテムのfactory関数が呼び出される
- **THEN** そのアイテム専用のDOM部分木の中に、内側の条件分岐用の
  `update_*`関数・factory関数がそのfactory関数のクロージャ内に生成され、
  アイテムごとに独立したインスタンスを持つ

#### Scenario: 条件分岐ブランチ内のリストのfactory生成
- **WHEN** 条件分岐の特定ブランチが選択され、そのブランチのfactory関数が
  呼び出される
- **THEN** そのブランチ専用のDOM部分木の中に、内側のリスト用の
  keyed reuse・factory関数がそのfactory関数のクロージャ内に生成され、
  ブランチが選択されている間だけ有効なkeyed Mapを持つ

### Requirement: ネストした構造ユニットのライフサイクル
コンパイラは、各ネストした構造ユニットのfactory instanceごとに、必要な
DOM範囲、ローカル状態、binding cache、keyed Map、更新処理を生成しなければ
ならない(SHALL)。外側の構造ユニット(リストアイテム・条件分岐ブランチ)が
破棄・再生成される際、内側の構造ユニットのfactory instance・keyed Map・
ローカル状態は、外側のDOM部分木の`remove()`とともに一括して失われる。
明示的なteardown呼び出しは生成しない。

#### Scenario: 外側条件分岐ブランチの切り替えによる内側リストの破棄
- **WHEN** 条件分岐ブランチ内にリストがネストしており、外側の条件分岐が
  別のブランチ(または非選択)に切り替わる
- **THEN** 生成されたコードは、明示的なteardown関数を呼び出さず、外側
  ブランチのDOM要素の`remove()`のみを行う(内側リストのkeyed Mapは
  参照ごと失われる)

#### Scenario: リストアイテムのkey差し替えによる内側条件分岐の破棄
- **WHEN** リストアイテム内に条件分岐がネストしており、そのアイテムの
  keyがkeyed diffで削除対象になる
- **THEN** 生成されたコードは、明示的なteardown関数を呼び出さず、
  アイテムのDOM要素の`remove()`のみを行う(内側条件分岐の状態は
  参照ごと失われる)

#### Scenario: 再生成されたbranchのbinding cacheは独立する
- **WHEN** itemのローカルsignalで条件分岐を切り替え、同じbranchを再生成する
- **THEN** 新しいbranch factoryは新しいbinding cacheを使い、祖先List itemの
  cacheが同じ値と判定してもtemplateの初期値を残さず、現在のitem値をDOMへ反映する

### Requirement: 構造ユニットのDOM範囲所有
コンパイラは、リスト/条件分岐ごとに開始・終了コメントアンカーを生成し、
その2つのアンカーの間だけを当該ユニットのDOM範囲として管理しなければ
ならない(SHALL)。構造ユニットを親要素全体の更新対象にしてはならず、静的な
兄弟要素や同じ親の別の構造ユニットを変更してはならない。

#### Scenario: 静的兄弟要素とリストの共存
- **WHEN** `<div><span>before</span>{items().map(...)}</div>` を含むソースを
  `compile()` して mount する
- **THEN** リスト項目は開始・終了アンカーの間に挿入され、`span` は
  リストの追加・並べ替え・削除で再生成されない

#### Scenario: 同じ親の複数構造ユニット
- **WHEN** 1つの親要素にリストと条件分岐を複数置いて mount/update する
- **THEN** 各ユニットは自身のアンカー範囲だけを生成・削除し、他のユニットと
  静的兄弟の順序を維持する

#### Scenario: 構造ユニットを含む親要素のハンドラ
- **WHEN** `<div onClick={handler}>{items().map(...)}</div>` を含むソースを
  `compile()` して mount する
- **THEN** 生成コードは `div` 要素自身へイベントリスナーを配線し、
  構造ユニットのアンカーIDと要素マーカーIDを混同しない

#### Scenario: range anchor hydration
- **WHEN** 初期HTMLに開始・終了アンカーを含む構造ユニットを
  `hydrate()` する
- **THEN** ランタイムはアンカー対を取得し、List/conditionalの初回更新を
  その範囲へ適用する。不完全なアンカー対は hydration error とする
