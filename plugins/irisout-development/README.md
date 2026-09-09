# irisout-development

irisoutでアプリを作成、診断、検証するためのAgent Pluginです。`irisout-development` Skill、
記述範囲の参照資料、Vite+アプリの雛形を含みます。

公開後は、npmを参照するプラグインマーケットプレイスから導入できます。ローカル確認では、
このディレクトリをプラグインとして登録します。

SkillはirisoutをReactとして扱わず、`irisout/vite`、`irisout/jsx`、
`virtual:irisout-entry`を使う構成と、コンパイラの対応範囲に従います。
