# ADR-0048: npm公開版検査とAI向けSkill配布

## ステータス

**npm公開版検査とSkill作成を実装、Skill公開先の確定待ち**(2026-09-09)

## 背景

`irisout` 0.1.0をnpmへ公開した後も、既存の梱包検査はローカルtarballだけを導入していた。
また、AIがirisoutをReactとして扱わず、公開入口とコンパイラの対応範囲に従ってアプリを
作るための配布可能な指示がなかった。

## 決定

- `bun run registry:smoke`でnpmの`irisout@0.1.0`を一時ディレクトリへ導入し、型検査、
  Vite構築、初期HTML、生成JavaScriptを確認する。
- `irisout-development` Skillへ、公開入口、記述規則、診断手順、検証条件を記載する。
- Vite+アプリの雛形をSkillのassetとして含める。
- Skillは可搬形式のAgent Pluginへまとめ、互換用のCodexマニフェストも含める。
- npmパッケージ候補名を`irisout-development`とする。外部公開は名前と公開先を確定してから
  別操作として行う。

## 結果

npm公開版だけを使う導入検査が通り、ローカル梱包物との差を検出できる。Skillとプラグインは
公式検証処理を通過し、npmパッケージまたはプラグインディレクトリとして配布できる。

注: SkillはAI向けの指示と資源の集合である。Agent PluginはSkillをインストール可能な単位へ
まとめる形式で、irisout本体のnpmパッケージとは別の版と公開履歴を持つ。
