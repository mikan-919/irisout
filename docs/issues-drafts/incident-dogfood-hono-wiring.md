# Hono文書ページの構築入口と開発APIの接続例がない

観測日: 2026-10-08。利用者試験Aの原文:

> Hono構成の本番構築に必要な入口設定が文書から分からない。

> 文書にはAPIの中継方法がない。

## 再現

`docs/hono-file-routing.md`の文書ページ、Hono app、Vite設定だけを作り、`index.html`を作らずに`vp build`する。`Cannot resolve entry module index.html`で止まる。Hono appへ`/api/incidents`を追加しても、Viteの開発URLでは404になる。

## 対応

文書のVite設定へ`build.rollupOptions.input: {}`を加えた。開発時はページGETだけを配信する契約を明記し、本文なしの検索GET・状態変更POSTを同じHono appへ渡す例を追加した。要求本文と認証ヘッダーはこの例の対象外と明記した。本体の対応範囲は変えていない。

利用者試験Aは入口設定とAPI接続の補完後に型検査・本番構築・独立した8項目の操作検査を通過した。修正文書だけによる新規実装の確認はv2報告へ記録する。
