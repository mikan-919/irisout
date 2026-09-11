## MODIFIED Requirements

### Requirement: 単一tarballの外部導入検査
梱包検査は一つの`irisout` tarballを作業領域外へ導入し、値形式と関数形式のsignal更新、配列一覧の型検査、本番構築、初期HTML、生成JavaScript、本番ソースマップ、作業領域指定の不存在を確認しなければならない(SHALL)。本番ソースマップは、生成されたイベント処理から梱包物外にある利用アプリの元JSX位置を取得できなければならない(SHALL)。

#### Scenario: 作業領域外の構築
- **WHEN** 梱包検査を実行する
- **THEN** 一つの`irisout` tarballと`vite-plus`だけを宣言した利用アプリで関数形式の配列signal更新を型検査して構築でき、生成されたイベント処理の位置から元のJSXファイルと行を取得できる
