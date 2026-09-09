## Why

npm公開後の配布物を直接検査し、AIがirisout固有の公開入口と記述範囲を使える配布物を用意する。

## What Changes

- npmの`irisout@0.1.0`を導入する検査を追加する。
- npm公開済みの状態へ文書を更新する。
- `irisout-development` Skillと配布用Agent Pluginを追加する。

## Non-goals

- Skillプラグインの外部公開操作。
- npm公開版の内容変更。
- irisoutの記述範囲拡張。

## Impact

- 検査スクリプト、公開文書、Skill、プラグイン、OpenSpecを変更する。
