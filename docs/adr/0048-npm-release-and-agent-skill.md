# ADR-0048: npm公開版検査とAI向けSkill配布

## ステータス

**npm公開版検査とSkill配布形式を実装**(2026-09-09)

## 背景

`irisout` 0.1.0をnpmへ公開した後も、既存の梱包検査はローカルtarballだけを導入していた。
また、AIがirisoutをReactとして扱わず、公開入口とコンパイラの対応範囲に従ってアプリを
作るための配布可能な指示がなかった。

## 決定

- `bun run registry:smoke`でnpmの`irisout@0.1.0`を一時ディレクトリへ導入し、型検査、
  Vite構築、初期HTML、生成JavaScriptを確認する。
- `irisout-development` Skillへ、公開入口、記述規則、診断手順、検証条件を記載する。
- Vite+アプリの雛形をSkillのassetとして含める。
- Skillは`skills/irisout-development/SKILL.md`を入口とし、`npx skills`がGitHub
  リポジトリから検出できる構成にする。
- 導入コマンドは`npx skills add mikan-919/irisout --skill irisout-development`とする。
- SkillをnpmパッケージやAgent Pluginとして別に包装しない。公開元と版管理はirisoutの
  GitHubリポジトリに集約する。

## 結果

npm公開版だけを使う導入検査が通り、ローカル梱包物との差を検出できる。Skillは
`npx skills`の検出と導入を通過し、GitHubリポジトリから配布できる。

注: SkillはAI向けの指示と資源の集合である。`npx skills`はGitリポジトリからSkillを探して
各AI実行環境へ配置するため、Skill専用のnpm公開は不要である。
