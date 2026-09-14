## Why

保存済み共有ページはビルド後に作られたIDを再ビルドなしで要求時に表示し、JavaScript無効時もソースと説明を読める必要がある。運営側のSSR部品から初期HTMLとhydrate stateを同じ表示データで生成し、投稿JSXの実行を避ける。

## What Changes

- `/playground/:id`を要求ごとに読み込み、未削除の保存値から初期HTMLを生成する。
- タイトル、説明、ソース全文、版、作成日時、未実行表示をSSRする。
- HTML文脈と引継ぎJSONをエスケープし、管理鍵をstateへ含めない。
- `irisout/ssr`の`render(input)`とstateを既存DOMのhydrateへ接続する。
- 404、503、版不一致、並行要求で正常ページ用stateを返さない。
- 限定公開の`noindex`、`no-referrer`、`no-store`を設定する。

## Capabilities

### New Capabilities

- `playground-ssr-page`: 保存済み共有ページのSSRとhydrate契約

### Modified Capabilities

なし。

## Impact

`app/web/server`、SSRルート部品、共有ページのHTML、hydrate接続、HTTPヘッダー、404・503処理に影響する。公開前に保存・削除・バックアップ・隔離配信の運用検査が必要になる。
