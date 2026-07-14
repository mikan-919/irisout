# list-conditional-rendering

## Purpose

リスト(`.map()`)・条件分岐(三項式・`&&`)を、ADR-0005が決定した
factory-per-unitクロージャで生成する(M5、change
`m5-list-conditional-factory-closures`)。`<template>`+`cloneNode(true)`の
スタンプ機構、アイテム/ブランチごとの1関数(クローン取得・ローカル状態・
`update_*`・`addEventListener`登録)、リスト更新のkeyed reuseを規定する。
リストアイテム内・条件分岐ブランチ内にさらにリスト/条件分岐がネストする
形(UNRESOLVED-06/07)は、本capabilityの対象外としてスコープ制限で拒否する
(follow-up: M5.5)。

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
からは除外されるがデータ配列には残っているkeyについては、Mapのエントリ・
ローカル状態を保持したままにしなければならない(SHALL)。

#### Scenario: データ配列からの削除
- **WHEN** アイテムが元データ配列(例: `todos()`)から削除される
- **THEN** 対応するkeyed Mapのエントリが破棄され、DOM要素が`remove()`
  される

#### Scenario: フィルタによる可視集合からの除外
- **WHEN** アイテムは元データ配列には残ったまま、フィルタ後の可視集合
  からのみ外れる
- **THEN** 対応するkeyed Mapのエントリ・ローカル状態は保持される
  (破棄されない)

### Requirement: アイテム/ブランチの明示的teardownは行わない
コンパイラが生成するコードは、リストアイテム・条件分岐ブランチが破棄
される際に、専用のteardown関数呼び出しを生成してはならない(SHALL NOT)。
keyed Mapから参照が落ち、DOM要素が`remove()`されれば、状態・リスナー・
DOM部分木はGC対象になる。

#### Scenario: アイテム削除時のteardown不在
- **WHEN** リストアイテムがkeyed Mapから破棄される
- **THEN** 生成されたコードは明示的なteardown関数を呼び出さず、DOM要素の
  `remove()`のみを行う

### Requirement: ネストした構造ユニットのスコープ制限
コンパイラは、リストアイテム内にさらにネストした条件分岐・リスト
(UNRESOLVED-07)、および条件分岐ブランチ内にネストしたリスト
(UNRESOLVED-06)を受理してはならず(SHALL NOT)、それらのパターンに
遭遇した場合は`compile:`で始まり`(scope limit)`を末尾に含むエラーを
投げなければならない(SHALL)。

#### Scenario: リストアイテム内の条件分岐の拒否
- **WHEN** authored コンポーネントのリストアイテムテンプレート内に条件
  分岐(例: 編集モードのspan/input切り替え)がある
- **THEN** コンパイラは`compile:`で始まり`(scope limit)`を末尾に含む
  エラーを投げ、生成を継続しない

#### Scenario: 条件分岐ブランチ内のリストの拒否
- **WHEN** authored コンポーネントの条件分岐ブランチ内にリスト
  (`.map()`によるJSX生成)がある
- **THEN** コンパイラは`compile:`で始まり`(scope limit)`を末尾に含む
  エラーを投げ、生成を継続しない
