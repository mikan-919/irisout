# irisout-agent-skill

## Purpose

AIがirisout固有の公開入口、記述範囲、診断、検証方法に従ってアプリを扱うSkillと、
GitHubリポジトリからの導入方法を規定する。

## Requirements

### Requirement: irisout固有の作業指示
SkillはirisoutをReact互換として扱わず、公開パッケージ入口、コンパイル時の部品合成、`signal(initial)`と`signal(previous => next)`、JSX `key`による一覧識別、構造記法、対応範囲外の診断、完了時の型検査と構築を指示しなければならない(SHALL)。二引数signalと`.update()`を案内してはならない(SHALL NOT)。

#### Scenario: 新規アプリ作成
- **WHEN** AIがirisoutアプリの作成を依頼される
- **THEN** `irisout/vite`、`irisout/jsx`、`virtual:irisout-entry`を使い、状態と更新を`signal`で記述して型検査と本番構築を行う

### Requirement: npx skillsによる配布

利用側アプリ用Skillは`skills/irisout/SKILL.md`に置き、`npx skills`がGitHubリポジトリから
発見して導入できなければならない(SHALL)。雛形はnpm公開版だけに依存しなければならない
(SHALL)。

#### Scenario: Skillの検出と導入

- **WHEN** 配布前の検証を実行する
- **THEN** `npx skills`が`irisout`を一覧に表示して一時ディレクトリへ導入でき、
  Skill検証が通り、未完了の雛形文言を含まない

### Requirement: 利用側と本体開発の分離

`irisout` Skillは別プロジェクトで公開パッケージを利用する作業だけを対象とし、
`irisout-development` Skillはirisoutソースリポジトリ内の作業だけを対象としなければならない(SHALL)。

#### Scenario: irisout本体の変更
- **WHEN** AIがコンパイラ、ランタイム、例、文書、試験、配布、またはSkillをこのリポジトリで変更する
- **THEN** `irisout-development`を選び、利用側アプリ用の雛形や公開版の導入手順を適用しない

#### Scenario: 別プロジェクトのアプリ変更
- **WHEN** AIが公開版irisoutに依存する別プロジェクトのアプリを変更する
- **THEN** `irisout`を選び、このリポジトリの内部開発手順を適用しない
