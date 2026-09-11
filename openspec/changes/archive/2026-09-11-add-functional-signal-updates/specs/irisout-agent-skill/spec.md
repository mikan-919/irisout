## MODIFIED Requirements

### Requirement: irisout固有の作業指示
SkillはirisoutをReact互換として扱わず、公開パッケージ入口、コンパイル時の部品合成、`signal(initial)`と`signal(previous => next)`、JSX `key`による一覧識別、構造記法、対応範囲外の診断、完了時の型検査と構築を指示しなければならない(SHALL)。二引数signalと`.update()`を案内してはならない(SHALL NOT)。

#### Scenario: 新規アプリ作成
- **WHEN** AIがirisoutアプリの作成を依頼される
- **THEN** `irisout/vite`、`irisout/jsx`、`virtual:irisout-entry`を使い、状態と更新を`signal`で記述して型検査と本番構築を行う
