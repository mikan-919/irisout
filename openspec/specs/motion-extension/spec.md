# Motion拡張仕様

## Requirement: Motion JSXの公開形式

利用者は`irisout/motion`から`motion`を読み込み、`<motion.div>`形式で記述できなければならない
(SHALL)。

### Scenario: layoutとanimateを記述する

- **WHEN** 利用者が`<motion.div layout animate={{ opacity: 1 }} />`を記述する
- **THEN** Vite変換器は`div`と`use=`へ変換し、公式Motionの実行時処理へ接続する
- **AND** `layout`と`animate`をDOM属性として出力しない

### Scenario: layoutIdで要素を引き継ぐ

- **WHEN** 同じ`layoutId`を持つ要素が別のDOM要素へ置き換わる
- **THEN** 旧要素の位置と寸法から新要素の位置と寸法へ配置アニメーションを行う
- **AND** `layoutId`をDOM属性として出力しない

### Scenario: 入れ子の配置変更

- **WHEN** `layout`要素の親と子が同じDOM更新で配置変更される
- **THEN** 文書順の投影木で親子のtransformを合成する
- **AND** 親の拡縮による子の歪みを補正する

### Scenario: 実行中に再更新する

- **WHEN** 配置アニメーションの完了前に同じ要素の配置が再び変わる
- **THEN** 現在の表示位置から新しい配置へアニメーションを継続する

## Requirement: 汎用DOM更新取引

生成コードは同期DOM更新の前後を、入れ子更新を一つにまとめた取引として通知しなければならない
(SHALL)。この取引はMotion固有の名前または型を持ってはならない(SHALL NOT)。

## Requirement: コンパイラとの境界

irisoutコンパイラ本体はMotion固有の要素名または属性名を解釈してはならない(SHALL NOT)。
Motion拡張は汎用ソース変換関数を通して、コンパイル前に標準irisout JSXへ変換しなければならない
(SHALL)。

### Scenario: Motionを使わない構築

- **WHEN** 利用者が通常の`irisout()`を使う
- **THEN** Motion実行時処理とMotion JSX変換器を読み込まない

## Requirement: 対応外属性の診断

Motion拡張は対応外のMotion属性を通常のDOM属性として受理してはならない(SHALL NOT)。

### Scenario: gesture属性を使う

- **WHEN** 利用者が`whileHover`を`motion`要素へ指定する
- **THEN** 型検査またはコンパイル前変換で対応外エラーを返す
