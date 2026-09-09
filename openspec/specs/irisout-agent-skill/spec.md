# irisout-agent-skill

## Purpose

AIがirisout固有の公開入口、記述範囲、診断、検証方法に従ってアプリを扱うSkillと、
その配布用Agent Pluginを規定する。

## Requirements

### Requirement: irisout固有の作業指示

SkillはirisoutをReact互換として扱わず、公開パッケージ入口、コンパイル時の部品合成、
状態と構造記法、対応範囲外の診断、完了時の型検査と構築を指示しなければならない(SHALL)。

#### Scenario: 新規アプリ作成

- **WHEN** AIがirisoutアプリの作成を依頼される
- **THEN** `irisout/vite`、`irisout/jsx`、`virtual:irisout-entry`を使い、型検査と本番構築を行う

### Requirement: 配布可能なプラグイン

Skillはルート`plugin.json`を持つ可搬Agent Pluginに含め、Codex互換マニフェストからも
発見できなければならない(SHALL)。雛形はnpm公開版だけに依存しなければならない(SHALL)。

#### Scenario: Skillプラグインの検証

- **WHEN** 配布前の検証を実行する
- **THEN** Skillとプラグインのマニフェストが検証を通り、未完了の雛形文言を含まない
