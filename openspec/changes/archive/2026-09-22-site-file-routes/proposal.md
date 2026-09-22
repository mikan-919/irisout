# 公式サイトのファイル経路移行

公式サイトの画面入口がVite設定とBunサーバーの静的経路へ分散している。ホーム、Playground、実例を`page.tsx`へ移し、同じファイル集合をVite+生成物と`irisout/hono`の要求単位SSRへ接続する。

Markdown文書の静的生成、保存済みPlaygroundのloaderとセキュリティーヘッダー、ブラウザー側の隔離実行は変更しない。
