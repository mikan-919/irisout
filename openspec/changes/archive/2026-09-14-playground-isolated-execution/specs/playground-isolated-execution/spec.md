## Purpose

投稿JSXの変換と実行を公式サイトの権限から分離し、Workerとsandbox iframeを実行単位として破棄できるようにすることで、失敗や停止後もPlaygroundを復旧できるようにする。

## ADDED Requirements

### Requirement: 実行権限の分離

実行管理画面は公式サイトと別配信元で提供し、投稿実行環境へ公式サイトのCookie、管理鍵、保存APIの権限を渡してはならない(SHALL NOT)。

#### Scenario: 投稿実行時の権限検査

- **WHEN** 投稿JSXを実行する
- **THEN** 実行管理画面と結果iframeから公式サイトのCookie、管理鍵、保存APIへアクセスできない

#### Scenario: 配信ヘッダーの検査

- **WHEN** 実行管理画面を別配信元から読み込む
- **THEN** `Content-Security-Policy`、`Referrer-Policy`、`X-Content-Type-Options`、`Permissions-Policy`が応答にあり、実行管理画面へ保存APIの経路がない

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
