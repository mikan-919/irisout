## Purpose

運営側が指定したIrisoutのルート部品を要求ごとに描画し、HTMLとJSON直列化可能なstateをブラウザへ渡して、既存DOMへhydrateできるサーバー用入口を提供する。

## ADDED Requirements

### Requirement: SSR入口の明示指定

公開パッケージは`irisout/ssr`と`irisoutSsr()`を提供し、利用者が指定したルート部品一つの初期描画全体をSSRしなければならない(SHALL)。部品単位のSSR指定とSSR可能性の自動判定を行ってはならない(SHALL NOT)。

#### Scenario: ルート部品のSSR

- **WHEN** Vite+設定で`irisoutSsr()`へルート部品を指定して構築する
- **THEN** 指定したルートの初期描画全体を要求時に呼び出せるSSR入口が生成される

### Requirement: HTMLとhydrate state

SSR入口の`render(input)`は`{ html, state }`を返さなければならず(SHALL)、`input`と`state`はJSONへ直列化できる値だけを含まなければならない(SHALL)。stateは対応するブラウザ生成物へ渡して既存HTMLのhydrateに使える形でなければならない(SHALL)。

#### Scenario: 初期HTMLの引継ぎ

- **WHEN** 同じ入力で`render(input)`の結果をHTMLへ埋め込み、ブラウザ用生成物をhydrateする
- **THEN** 初期HTMLを再生成せず、入力と局所stateを使って既存DOMへ接続できる

### Requirement: 初期SSRの対応記法

初期SSRは入力、テキスト、属性、条件分岐、局所signalを処理しなければならない(SHALL)。

#### Scenario: 対応記法の描画

- **WHEN** 固定ページが入力値、テキスト、属性、条件分岐、局所signalを使う
- **THEN** 入力ごとに異なるHTMLとhydrate stateが生成される

### Requirement: SSRで実行しない処理

SSRはイベント処理、`onMount`、`effect`、`use=`を実行してはならず(SHALL NOT)、module共有状態を使う入力を診断で拒否しなければならない(SHALL)。

#### Scenario: クライアント専用処理

- **WHEN** ルート部品がイベント、`onMount`、`effect`、`use=`を含む
- **THEN** SSR中に副作用を起こさず、クライアント接続用の処理としてだけ扱う

#### Scenario: module共有状態

- **WHEN** ルート部品がmodule scopeの共有signalまたはderivedを読む
- **THEN** 要求間共有を許可せず、`compile:` scope limit診断を返す
