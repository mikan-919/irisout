## Why

npm公開後の配布物を直接検査し、AIがirisout固有の公開入口と記述範囲を使える配布物を用意する。

## What Changes

- npmの`irisout@0.1.0`を導入する検査を追加する。
- npm公開済みの状態へ文書を更新する。
- `irisout-development` Skillを`npx skills`でGitHubから導入できる構成にする。

## Non-goals

- GitHubリポジトリへの反映操作とskills.shへの掲載確認。
- npm公開版の内容変更。
- irisoutの記述範囲拡張。

## Impact

- 検査スクリプト、公開文書、Skill、OpenSpecを変更する。
