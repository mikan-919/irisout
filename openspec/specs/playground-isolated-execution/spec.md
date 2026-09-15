# playground-isolated-execution Specification

## Purpose
投稿JSXの変換と実行を公式サイトの権限から分離し、Workerとsandbox iframeを実行単位として破棄できるようにすることで、失敗や停止後もPlaygroundを復旧できるようにする。

## Requirements

### Requirement: 編集入力の提供

公式画面は単一JSXの編集にMonaco Editorを使い、編集値を保存、書き出し、実行が参照する元の入力値と同期しなければならない(SHALL)。エディタ本体と言語機能はPlaygroundの初期化時に遅延読込みし、読込みに失敗した場合は元のテキスト入力を残さなければならない(SHALL)。

#### Scenario: Monacoからの実行

- **WHEN** 利用者がMonaco EditorでJSXを変更し、実行する
- **THEN** 変更後の同じ値が公式画面の入力値となり、実行管理画面へ送られる

#### Scenario: エディタの読込み失敗

- **WHEN** Monaco Editorまたは言語機能を読み込めない
- **THEN** 元のテキスト入力を表示したまま、入力値を失わない

### Requirement: 実行権限の分離

実行管理画面は公式サイトと別配信元で提供し、投稿実行環境へ公式サイトのCookie、管理鍵、保存APIの権限を渡してはならない(SHALL NOT)。公式Originと実行管理Originは設定値をOriginへ正規化したうえで異なるhostnameにし、本番の実行管理Originを省略してはならない(SHALL)。設定不足または同一hostnameを検出した場合、sourceを保持したまま実行だけを無効にしなければならない(SHALL)。Cookie Domainは両配信元で共有してはならない(SHALL NOT)。

#### Scenario: 投稿実行時の権限検査

- **WHEN** 投稿JSXを実行する
- **THEN** 実行管理画面と結果iframeから公式サイトのCookie、管理鍵、保存APIへアクセスできない

#### Scenario: 配信元設定不足

- **WHEN** 実行管理Originが未設定、形式不正、または公式Originと同じhostnameである
- **THEN** sourceを失わず、実行管理iframeを作らず、実行不可の理由を表示する

#### Scenario: 配信ヘッダーの検査

- **WHEN** 実行管理画面を別配信元から読み込む
- **THEN** `Content-Security-Policy`、`Referrer-Policy`、`X-Content-Type-Options`、`Permissions-Policy`が応答にあり、実行管理画面へ保存APIの経路がない

#### Scenario: frame-ancestorsのOrigin検査

- **WHEN** 検証済みの公式Originから実行管理画面を埋め込む、または別Originから埋め込む
- **THEN** 前者だけが表示され、`frame-ancestors`は固定localhostではなく正規化済みの公式Originを含み、別Originからの表示は拒否される

### Requirement: 実行単位の破棄

コンパイルWorkerと結果iframeは実行ごとに作成し、成功、失敗、取消し、時間超過のいずれでも破棄しなければならない(SHALL)。初期設定ではコンパイルを5秒、結果を1 MiBに制限しなければならない(SHALL)。

#### Scenario: 時間超過後の再実行

- **WHEN** 投稿JSXが5秒を超えて実行され、利用者が再実行する
- **THEN** 旧Workerと結果iframeが破棄され、新しい実行だけが結果を表示する

#### Scenario: 結果サイズの超過

- **WHEN** 生成されたcodeと初期HTMLの合計が1 MiBを超える
- **THEN** 結果iframeを作らず、入力を失わない診断を表示する

### Requirement: 結果iframeの権限制限

結果iframeは`sandbox="allow-scripts"`を基準とし、同一生成元、フォーム送信、上位画面への遷移、ポップアップ、ダウンロードを許可してはならない(SHALL NOT)。

#### Scenario: 生成結果の権限試行

- **WHEN** 結果コードが親画面のDOM、フォーム送信、上位遷移またはポップアップを試みる
- **THEN** 試行は結果iframeの境界内で拒否され、公式サイトの状態は変更されない

#### Scenario: 結果コードの外部通信

- **WHEN** 結果コードが外部URLへ通信またはダウンロードを試みる
- **THEN** `connect-src 'none'`と`sandbox="allow-scripts"`により通信とダウンロードを許可しない

### Requirement: 応答の世代検証

親画面はWorkerまたはiframeから受け取るメッセージの送信元、形式、サイズ、実行番号を検証し、現在の実行番号と一致しない結果を表示してはならない(SHALL NOT)。

#### Scenario: 古い実行結果

- **WHEN** 旧実行番号の成功メッセージが新しい実行の後に届く
- **THEN** 旧結果は破棄され、現在の実行結果だけが表示される

#### Scenario: 受信値の表示

- **WHEN** 実行管理画面から診断メッセージが届く
- **THEN** 親画面は検査済みの文字列を`textContent`へ設定し、受信値をHTMLとして解釈しない
