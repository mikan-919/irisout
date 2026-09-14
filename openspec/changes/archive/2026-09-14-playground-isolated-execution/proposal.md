## Why

投稿JSXはコンパイル時にもコードとして動くため、公式サイトの画面やCookie、管理鍵、保存APIと同じ権限で実行してはならない。Playgroundの編集・実行を別配信元、Worker、sandbox iframeへ分け、停止と失敗から復旧できる実行境界を作る。

## What Changes

- 実行管理画面を公式サイトと別配信元へ分ける。
- 実行ごとにコンパイルWorkerと結果iframeを作成し、完了・失敗・取消しで破棄する。
- 結果iframeの権限を`sandbox="allow-scripts"`を基準に制限する。
- Worker、iframe、親画面のメッセージ形式、送信元、サイズ、実行番号を検査する。
- 初期上限をコンパイル5秒、結果1 MiBとして試験し、動作不能と外部通信を検出する。
- ソース編集後の旧結果を表示せず、旧実行番号の結果を破棄する。

## Capabilities

### New Capabilities

- `playground-isolated-execution`: 投稿JSXの隔離変換・実行と復旧契約

### Modified Capabilities

なし。

## Impact

`app/web`の実行管理画面、別配信元のヘッダー、Worker、結果iframe、CSP、実行状態表示に影響する。隔離を成立させられない場合は共有機能を公開しない。
