## Purpose

保存済み共有ページを要求ごとに安全な初期HTMLとして返し、JavaScriptなしの閲覧と同じ表示データを使うhydrateを成立させて、IrisoutのSSR利用例を提供する。

## ADDED Requirements

### Requirement: 保存IDの要求時描画

共有ページはビルド後に作成された未削除のIDを要求時に読み込み、タイトル、説明、ソース全文、コンパイラ版、作成日時、未実行表示を含む初期HTMLを返さなければならない(SHALL)。

#### Scenario: 再ビルドなしの共有閲覧

- **WHEN** サイトをビルドした後に保存IDへアクセスする
- **THEN** 再ビルドなしで保存値を含む200の初期HTMLが返る

### Requirement: 初期HTMLとstateの一致

共有ページは同じ表示データから初期HTMLとhydrate stateを生成し、ブラウザが初期HTMLを再生成せずに既存DOMへ接続できなければならない(SHALL)。

#### Scenario: JavaScript有効時のhydrate

- **WHEN** JavaScriptを有効にして共有ページを開く
- **THEN** hydrate後のソース、版、見出し、文字数が初期HTMLの表示と一致する

### Requirement: 保存値の出力安全性

タイトル、説明、ソースはHTML文脈ごとにエスケープし、stateのJSONはscript要素から脱出できない形で出力しなければならない(SHALL)。管理鍵をHTML、state、OGP、ログへ含めてはならない(SHALL NOT)。

#### Scenario: 閉じタグを含む保存値

- **WHEN** 保存値に閉じタグ、引用符、`</script>`、イベント属性が含まれる
- **THEN** HTMLまたはscriptとして実行されず、同じ文字列として表示される

### Requirement: 失敗要求の分離

未存在・削除済みIDは404、保存先停止は503を返し、正常ページ用のHTMLまたはstateを生成してはならない(SHALL NOT)。

#### Scenario: 保存先停止

- **WHEN** 共有ページの記録を読み込めない
- **THEN** 503と障害表示を返し、別の共有ページのstateを返さない

### Requirement: 投稿JSXをSSRしない

共有ページのSSRは運営側のルート部品だけを実行し、保存されたJSXをコンパイルまたは実行してはならない(SHALL NOT)。

#### Scenario: ソース全文の表示

- **WHEN** 保存済みJSXを含む共有ページを要求する
- **THEN** JSXはエスケープされたソース文字列として表示され、生成HTMLや実行結果は作られない
