# Motion拡張仕様

## Purpose

irisoutのJSXから公式Motionのアニメーションと配置投影を利用するための受入条件を定める。

## Requirements

### Requirement: Motion JSXの公開形式

利用者は`irisout/motion`から`motion`を読み込み、`<motion.div>`形式で記述できなければならない
(SHALL)。

#### Scenario: layoutとanimateを記述する

- **WHEN** 利用者が`<motion.div layout animate={{ opacity: 1 }} />`を記述する
- **THEN** Vite変換器は`div`と`use=`へ変換し、公式Motionの実行時処理へ接続する
- **AND** `layout`と`animate`をDOM属性として出力しない

#### Scenario: layoutIdで要素を引き継ぐ

- **WHEN** 同じ`layoutId`を持つ要素が別のDOM要素へ置き換わる
- **THEN** 旧要素の位置と寸法から新要素の位置と寸法へ配置アニメーションを行う
- **AND** `layoutId`をDOM属性として出力しない

#### Scenario: 入れ子の配置変更

- **WHEN** `layout`要素の親と子が同じDOM更新で配置変更される
- **THEN** 文書順の投影木で親子のtransformを合成する
- **AND** 親の拡縮による子の歪みを補正する

#### Scenario: 実行中に再更新する

- **WHEN** 配置アニメーションの完了前に同じ要素の配置が再び変わる
- **THEN** 現在の表示位置から新しい配置へアニメーションを継続する

### Requirement: 退場アニメーション

利用者は`AnimatePresence`内のmotion要素に`exit`を指定し、条件分岐またはkey付き一覧から
削除された要素をアニメーション完了まで保持できなければならない(SHALL)。

#### Scenario: 条件分岐から削除する

- **WHEN** `AnimatePresence`内の条件分岐から`exit`付きmotion要素が外れる
- **THEN** 要素は`exit`の目標値へ移り、完了後にDOMから除去される
- **AND** `AnimatePresence`は余分なDOM要素を作らない

#### Scenario: key付き一覧を更新する

- **WHEN** key付き一覧から`exit`付きmotion要素を削除し、同じ更新で別の要素を追加する
- **THEN** 旧要素の退場と新要素の追加を同時に開始する
- **AND** 既存keyの並べ替えでは`exit`を開始しない

#### Scenario: 所有する部品を破棄する

- **WHEN** 条件分岐や一覧の更新ではなく、部品全体を破棄する
- **THEN** `exit`を開始せず、所有要素を除去する

#### Scenario: 対応外の退場設定を使う

- **WHEN** `AnimatePresence`の外で`exit`を指定するか、`mode="wait"`または`mode="popLayout"`を指定する
- **THEN** 変換器は対応外として拒否する

### Requirement: 汎用DOM更新取引

生成コードは同期DOM更新の前後を、入れ子更新を一つにまとめた取引として通知しなければならない
(SHALL)。この取引はMotion固有の名前または型を持ってはならない(SHALL NOT)。

#### Scenario: 入れ子の更新を通知する

- **WHEN** 生成された更新処理が入れ子でDOMを書き換える
- **THEN** 最外周の更新前と更新後に一回ずつ通知する
- **AND** 通知の名前と型にMotion固有の項目を含めない

### Requirement: コンパイラとの境界

irisoutコンパイラ本体はMotion固有の要素名または属性名を解釈してはならない(SHALL NOT)。
Motion拡張は汎用ソース変換関数を通して、コンパイル前に標準irisout JSXへ変換しなければならない
(SHALL)。

#### Scenario: Motionを使わない構築

- **WHEN** 利用者が通常の`irisout()`を使う
- **THEN** Motion実行時処理とMotion JSX変換器を読み込まない

### Requirement: 対応外属性の診断

Motion拡張は対応外のMotion属性を通常のDOM属性として受理してはならない(SHALL NOT)。

#### Scenario: gesture属性を使う

- **WHEN** 利用者が`whileHover`を`motion`要素へ指定する
- **THEN** 型検査またはコンパイル前変換で対応外エラーを返す
