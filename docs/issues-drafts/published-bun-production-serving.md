# 本番生成物をBunで配信する例がない

観測日: 2026-10-18。公開版0.3.7を使った利用者試験の原文:

> 構築されたJavaScriptの配信は、利用側のHTTPサーバーへ接続する。

> 具体的な本番Bun配信例はない。Bun.fileでdist/irisout-client.jsとdist/assets以下を返すserveは通常のBun知識から補った。

## 再現

`docs/hono-file-routing.md`のHono appとVite設定を構築すると`dist/irisout-client.js`と`dist/assets/`以下が生成される。Honoのページ/APIを配信するだけでは、その生成物を配信する接続がなく、ブラウザー側の初期化と遷移を開始できない。

## 修正済み

同文書へ`server/start.ts`と構築・起動コマンドを追記した。導入済みHono 4の`serveStatic`でGET・HEADの生成物を配信し、ページ/APIは既存の`app`へ渡す。起動ファイルはVite設定から読むapp定義と分け、起動時に必要な元ファイルと依存も明記した。

公開版0.3.7の隔離構成で文書の起動例を実行し、ページのSSR、起動用JavaScript、分割されたJavaScript、API、存在しない生成物の404、HEAD応答を検証した。

## 未解決

この課題に残る未解決事項はない。この例はBunとHono 4での起動を対象とし、別の実行環境の配備手順は扱わない。
