# file-routing Specification

## Purpose
`page.tsx`または`page.jsx`のファイル構造をサーバーとブラウザーが共有できる経路定義へ変換し、二重の経路記述なしで同じページ選択と引数解決を提供する。

## Requirements

### Requirement: page.tsxからの経路生成

指定ディレクトリの各階層にある`page.tsx`または`page.jsx`をページとして登録しなければならない(SHALL)。指定ディレクトリ直下は`/`、通常の階層名はその階層の経路、`[name]`という階層名は`:name`という動的引数へ変換しなければならない(SHALL)。同じ階層に両方ある場合は曖昧な経路として拒否しなければならない(SHALL)。それ以外のファイルと、対応外の角括弧表記は登録してはならない(SHALL NOT)。

#### Scenario: page.tsxを経路へ変換する

- **WHEN** `page.tsx`、`users/page.tsx`、`users/[id]/page.tsx`を走査する
- **THEN** `/`、`/users`、`/users/:id`の経路定義が生成される

#### Scenario: ページ以外を除外する

- **WHEN** 指定ディレクトリに`users.js`や`users/view.jsx`がある
- **THEN** それらはページ経路に含まれない

#### Scenario: 同じ階層のページ名を一意にする

- **WHEN** 同じディレクトリに`page.tsx`と`page.jsx`がある
- **THEN** 両方の存在を示す診断で生成が失敗する

### Requirement: 決定的な優先順位と衝突診断

同じ階層数で静的な階層と動的な階層が一致する場合、静的な経路を先に照合しなければならない(SHALL)。同じ位置に複数の動的引数を置いた経路は衝突として扱い、対象となるファイルを含む診断を出して生成を失敗させなければならない(SHALL)。

#### Scenario: 静的経路を優先する

- **WHEN** `/users/new`と`/users/:id`があり、`/users/new`を照合する
- **THEN** `/users/new`が選択される

#### Scenario: 動的経路の衝突を拒否する

- **WHEN** `users/[id]/page.tsx`と`users/[name]/page.tsx`を同じ表へ生成する
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

経路生成を再実行した結果は、その時点で存在する`page.tsx`または`page.jsx`だけを含まなければならない(SHALL)。削除または名前変更されたページの経路を以前の生成結果から残してはならない(SHALL NOT)。

#### Scenario: ページ削除後に再生成する

- **WHEN**`old/page.tsx`を削除して`new/page.tsx`を追加した後に生成を実行する
- **THEN** `/new`だけが存在し、`/old`は未一致になる

### Requirement: ブラウザー向け境界

ブラウザー向けの経路表はファイルシステム処理、Hono、loader実装へ依存してはならない(SHALL NOT)。サーバー専用のファイルpathや要求情報をブラウザー向け経路定義へ含めてはならない(SHALL NOT)。

#### Scenario: client表を単独で使う

- **WHEN** 共通経路表をブラウザー用へ変換する
- **THEN** 経路照合がNode fsやHonoなしで実行でき、server専用file pathを持たない

### Requirement: pageのソース変換

Honoのファイル経路は、各pageをSSRする前に任意のファイル単位ソース変換を適用できなければならない(SHALL)。変換を指定しないpageの動作を変更してはならない(SHALL NOT)。

#### Scenario: Motion pageを標準記法へ変換する

- **WHEN** Motion変換を指定して`page.tsx`をファイル経路へ登録する
- **THEN** 各pageを標準irisout記法へ変換してからSSRする

### Requirement: Hono経路をVite構築のSSOTとして使う

`createFileRouter()`が登録した処理関数は、ページのファイルパスと生成条件を明示情報として保持しなければならない(SHALL)。`irisoutHono(app)`はHonoへmountされた後の経路だけを読み、ブラウザー向け経路とページ入口を生成しなければならない(SHALL)。Vite設定へ経路ディレクトリまたは接頭辞を再指定させてはならず(SHALL NOT)、irisout以外のHono経路をページ入口へ含めてはならない(SHALL NOT)。

#### Scenario: mount後の経路を構築へ渡す

- **WHEN** `createFileRouter('./routes')`をHono appの`/apps`へmountし、そのappを`irisoutHono(app)`へ渡す
- **THEN** `/apps`以下のブラウザー向け経路が生成され、Vite設定に`./routes`または`/apps`を再記述しない

#### Scenario: 通常のHono経路を除外する

- **WHEN** 同じappに`/api/health`とirisoutのページ経路が登録されている
- **THEN** `/api/health`はirisoutのブラウザー向け経路表へ含まれない

### Requirement: ページ単位のVite分割

`irisoutHono(app)`はブラウザー入口をViteの出力として自動的に発行しなければならず(SHALL)、利用側へ仮想モジュールのimportを要求してはならない(SHALL NOT)。内部のブラウザー向け入口は各ページを動的importとして参照しなければならない(SHALL)。チャンク分割、共有チャンク抽出、圧縮、ハッシュ付与はViteへ委ね、irisout側で再実装してはならない(SHALL NOT)。

#### Scenario: ページ入口を動的に読み込む

- **WHEN** 複数のページを含むHono appをViteで構築する
- **THEN** 各ページは動的import境界になり、Viteが出力チャンクを決める

#### Scenario: ブラウザー入口を自動発行する

- **WHEN** Vite設定のプラグイン配列へ`irisoutHono(app)`を登録する
- **THEN** `irisout-client.js`が構築され、利用側のJavaScriptに`virtual:*`のimportを書かない
