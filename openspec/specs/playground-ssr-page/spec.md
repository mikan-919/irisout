## Purpose

保存済み共有値をSQLiteから要求ごとに読み、運営側のIrisout SSR部品でHTMLとhydrate stateを
生成する。投稿されたJSXはサーバーでコンパイルまたは実行せず、限定公開ページとして扱う。

## Requirements

### Requirement: トップ編集ページの静的配信

`/playground`と`/playground?example=...`は、共有ページ用の空のHTMLではなく、SSGで生成した
`data-playground-root`を持つ編集画面を返さなければならない(SHALL)。末尾slash付きの要求は
`/playground`へ308で転送しなければならない(SHALL)。クエリの`example`は`examples.json`に登録された
一つの識別子だけを初期選択に使い、不在、未知、重複値は先頭例へ戻さなければならない(SHALL)。
クエリ値をファイルパスへ変換してはならない(SHALL NOT)。

#### Scenario: トップ編集画面を直接開く

- **WHEN** 利用者が`/playground`または`/playground?example=list`へアクセスする
- **THEN** 応答HTMLに`data-playground-root`、実行、保存、書き出しの要素があり、ブラウザ側の初期化が完了する

#### Scenario: 例の初期選択を検査する

- **WHEN** `example`へCounter、List、SVGの登録済み識別子、不在値、未知値、重複値を指定する
- **THEN** 登録済みの一つの値だけが選択され、それ以外は先頭例が選択される

### Requirement: 共有ページの要求描画

`/playground/:id`はビルド後に作られた未削除IDをSQLiteから一度だけ読み、許可された表示値を
`irisout/ssr`の`render(input)`へ渡して200を返さなければならない(SHALL)。表示値はタイトル、説明、
source全文、compilerVersion、createdAt、未実行表示を含み、head、本文、stateで同じ値を使わなければ
ならない(SHALL)。保存されたJSXは文字列としてのみ扱い、サーバーでコンパイルまたは実行してはならない
(SHALL NOT)。

#### Scenario: ビルド後の保存IDを直接表示する

- **WHEN** サイトをビルドした後に保存APIで作ったIDへ直接GETする
- **THEN** 再ビルドなしで200となり、HTMLに保存時のタイトル、説明、source全文、版、作成日時、未実行表示がある

#### Scenario: 投稿JSXをSSRへ渡さない

- **WHEN** 保存値のsourceにサーバー側で実行される副作用の文字列が含まれる
- **THEN** sourceはHTMLとstateへ文字列として表示され、副作用は実行されない

### Requirement: hydrateの一致

初期HTMLの本文と、`render(input)`のstateを使ったhydrate後のDOMは、見出し、source全文、版、文字数が
一致しなければならない(SHALL)。JavaScriptを無効にしても初期HTMLを読めなければならない(SHALL)。
トップPlaygroundの編集欄は、`examples.json`の読込みと実行管理iframeの接続が両方完了するまで
読取り専用でなければならない(SHALL)。共有ページから複製したsourceまたは接続前に入力されたsourceを、
例の初期値で上書きしてはならない(SHALL NOT)。実行管理Originが設定不備の場合は、例の読込み後に
sourceの編集、保存、書き出しを許可し、実行だけを無効にしなければならない(SHALL)。

#### Scenario: JavaScript無効時とhydrate後の表示を一致させる

- **WHEN** 同じ共有URLをJavaScript無効と有効のブラウザーで開く
- **THEN** 見出し、source全文、版、文字数が初期HTMLとhydrate後DOMで一致する

#### Scenario: 遅延した初期化中のsource保持

- **WHEN** 例データまたは実行管理iframeの応答が遅れている状態で共有ページから複製し、sourceへ入力する
- **THEN** 接続完了まで編集欄は読取り専用で、接続後も複製値または入力値が例の初期値へ置き換わらない

#### Scenario: 実行管理Originの設定不備

- **WHEN** 実行管理Originが未設定、形式不正、または公式Originと同じhostnameである
- **THEN** 例の読込み後にsourceの編集、保存、書き出しができ、実行管理iframeを作らず実行だけが無効になる

### Requirement: HTTP境界

存在しない、削除済み、形式不正のIDは404を返し、正常ページ用HTMLまたはstateを返してはならない
(SHALL NOT)。保存先が停止した場合は503、`cache-control: no-store`、`x-robots-tag: noindex`、
`referrer-policy: no-referrer`を返さなければならない(SHALL)。正規URLは末尾slashなしとし、末尾slash
付き要求は308で転送しなければならない(SHALL)。

#### Scenario: 不在IDと保存先停止

- **WHEN** 不正または削除済みID、または停止した保存先へ共有ページを要求する
- **THEN** 前者は正常ページ用stateを含まない404、後者は`no-store`・`noindex`・`no-referrer`付き503になる

### Requirement: 文脈ごとの安全な出力

タイトル、説明、sourceをHTML本文、属性、OGP、埋込みJSONへ出すとき、閉じタグ、引用符、`</script>`、
イベント属性が実行可能な文脈にならないようescapeしなければならない(SHALL)。管理鍵、削除用値、投稿
コードの実行結果はHTML、state、OGP、ログへ含めてはならない(SHALL NOT)。

#### Scenario: HTMLと埋込みJSONの脱出

- **WHEN** タイトル、説明、sourceへ閉じタグ、引用符、`</script>`、イベント属性を含める
- **THEN** 初期HTMLと埋込みJSONからscript終了やイベント属性の実行文脈が作られない

### Requirement: 要求状態と復旧

A/Bの並行要求、片方の失敗、直後の正常要求でstateを共有してはならない(SHALL NOT)。保存、直接URL、
複製、管理鍵削除、削除後404をブラウザーで確認できなければならない(SHALL)。実運用の保存先が未確定
の場合、ローカルSQLiteのバックアップ復元後に削除記録を再適用する手順と自動試験を備え、公開済みの
復元機能とは記述してはならない(SHALL)。

#### Scenario: 要求間分離と削除記録

- **WHEN** A/B共有の並行要求、片方の失敗、直後の正常要求、バックアップ復元後の削除記録再適用を行う
- **THEN** 各stateが混ざらず、削除済み共有は404のままになる
