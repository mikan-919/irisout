## Purpose

`page.jsx`のファイル構造をサーバーとブラウザーが共有できる経路定義へ変換し、二重の経路記述なしで同じページ選択と引数解決を提供する。

## ADDED Requirements

### Requirement: page.jsxからの経路生成

指定ディレクトリの各階層にある`page.jsx`だけをページとして登録しなければならない(SHALL)。指定ディレクトリ直下は`/`、通常の階層名はその階層の経路、`[name]`という階層名は`:name`という動的引数へ変換しなければならない(SHALL)。`page.jsx`以外のファイルと、対応外の角括弧表記は登録してはならない(SHALL NOT)。

#### Scenario: page.jsxを経路へ変換する

- **WHEN** `page.jsx`、`users/page.jsx`、`users/[id]/page.jsx`を走査する
- **THEN** `/`、`/users`、`/users/:id`の経路定義が生成される

#### Scenario: page.jsx以外を除外する

- **WHEN** 指定ディレクトリに`users.js`や`users/view.jsx`がある
- **THEN** それらはページ経路に含まれない

### Requirement: 決定的な優先順位と衝突診断

同じ階層数で静的な階層と動的な階層が一致する場合、静的な経路を先に照合しなければならない(SHALL)。同じ位置に複数の動的引数を置いた経路は衝突として扱い、対象となるファイルを含む診断を出して生成を失敗させなければならない(SHALL)。

#### Scenario: 静的経路を優先する

- **WHEN** `/users/new`と`/users/:id`があり、`/users/new`を照合する
- **THEN** `/users/new`が選択される

#### Scenario: 動的経路の衝突を拒否する

- **WHEN** `users/[id]/page.jsx`と`users/[name]/page.jsx`を同じ表へ生成する
- **THEN** 両方のファイル名を含む衝突診断で生成が失敗する

### Requirement: 共通照合と正規化

サーバー用とブラウザー用の経路表は同じ経路、引数、検索引数を返さなければならない(SHALL)。ルート以外の末尾斜線は同一経路として扱い、検索引数とfragmentは経路選択から除外しなければならない(SHALL)。動的引数は一度だけ復号し、不正な符号化または復号後に`/`を含む値は未一致にしなければならない(SHALL)。

#### Scenario: URL正規化と引数復号

- **WHEN** `/users/a%20b/?tab=profile#top`を`/users/:id`へ照合する
- **THEN** `id`は`a b`、検索引数は`tab=profile`となり、fragmentは照合に影響しない

#### Scenario: 不正な引数を未一致にする

- **WHEN** `/users/a%2Fb`または不正なpercent encodingを照合する
- **THEN** 動的経路へ解決せず未一致になる

### Requirement: 現在のファイル集合の再生成

経路生成を再実行した結果は、その時点で存在する`page.jsx`だけを含まなければならない(SHALL)。削除または名前変更されたページの経路を以前の生成結果から残してはならない(SHALL NOT)。

#### Scenario: ページ削除後に再生成する

- **WHEN**`old/page.jsx`を削除して`new/page.jsx`を追加した後に生成を実行する
- **THEN** `/new`だけが存在し、`/old`は未一致になる

### Requirement: ブラウザー向け境界

ブラウザー向けの経路表はファイルシステム処理、Hono、loader実装へ依存してはならない(SHALL NOT)。サーバー専用のファイルpathや要求情報をブラウザー向け経路定義へ含めてはならない(SHALL NOT)。

#### Scenario: client表を単独で使う

- **WHEN** 共通経路表をブラウザー用へ変換する
- **THEN** 経路照合がNode fsやHonoなしで実行でき、server専用file pathを持たない
