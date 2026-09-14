## Purpose

公式文書を一つの正本から静的HTMLへ変換し、直接URL、参照検査、検索索引を提供することで、JavaScriptを実行できない環境でもIrisoutの導入情報を読めるようにする。

## ADDED Requirements

### Requirement: 文書正本と初回掲載範囲

文書生成は`docs/getting-started.md`を導入文書の正本として参照し、初回の文書分類を導入、状態と更新、イベント、条件分岐と一覧、部品とファイル分割、ライフサイクル、API、診断と対応範囲に限定しなければならない(SHALL)。公式例はCounter、List、SVGを同じ入力から文書表示用コードと後続Playground接続用`examples.json`へ展開しなければならない(SHALL)。Playground画面が`examples.json`を読み込む処理は後続changeの責務とする。

#### Scenario: 正本からの導入文書生成

- **WHEN** サイト生成を実行する
- **THEN** `docs/getting-started.md`の内容から導入ページが生成され、同じ本文をJSXへ複製した入力は要求されない

### Requirement: 静的文書の直接閲覧

生成物は文書一覧と文書詳細を静的HTMLとして出力し、JavaScriptを無効にしたブラウザから直接URL、本文、目次、前後リンクを閲覧できなければならない(SHALL)。

#### Scenario: JavaScriptなしの文書閲覧

- **WHEN** 利用者が`/docs`または`/docs/:slug`へ直接アクセスする
- **THEN** 文書本文と移動要素がサーバーの静的HTMLだけで表示される

### Requirement: 文書入力の検査

生成は重複slug、未知の分類、分類内の順序重複、相対・絶対の文書または見出し参照切れ、画像参照切れ、登録されていない例、許可されないHTMLまたはコード言語、path traversal、不正なpercent encodingを検出した場合に失敗しなければならない(SHALL)。`/docs`は文書一覧への絶対参照として許可する(SHALL)。

#### Scenario: 不正な文書入力

- **WHEN** 重複slugまたは切れた例参照を含む入力で生成する
- **THEN** 公開物を出力せず、対象を示すビルドエラーを返す

#### Scenario: 絶対参照の検査

- **WHEN** 文書が`/docs`、`/docs/:slug#heading`、`/docs/assets/...`を参照する
- **THEN** 一覧または実在する文書・見出し・画像だけが正規URLへ解決され、存在しない対象、path traversal、不正なpercent encodingはビルドエラーになる

### Requirement: 文書とPlaygroundの依存分離

文書閲覧用の生成物はPlaygroundコンパイラとMarkdown解析器をブラウザへ送ってはならず(SHALL NOT)、検索はビルド時に生成したタイトル・見出し索引を使わなければならない(SHALL)。

#### Scenario: 文書ページの依存検査

- **WHEN** 文書ページを本番構築して通信と依存一覧を調べる
- **THEN** コンパイラとMarkdown解析器の読込みがなく、検索索引だけが取得される
