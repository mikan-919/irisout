# ADR-0056: `page.jsx`のファイル経路をHono SSRとブラウザー遷移へ接続する

- **状態**: 決定済み・実装済み
- **日付**: 2026-09-16

## コンテキスト

既存の`irisout/ssr`は一つの部品から要求単位の`render(input)`を生成するが、ページの
ファイル構造、サーバー経路、ブラウザーの遷移は別々に記述する必要があった。動的経路の
静的優先、引数の復号、末尾斜線の扱いをサーバーとブラウザーで別実装すると結果がずれる。

## 決定

- `page.jsx`の親ディレクトリを経路として走査する。`page.jsx`、`users/page.jsx`、
  `users/[id]/page.jsx`はそれぞれ`/`、`/users`、`/users/:id`になる。
- `packages/routes/src/index.ts`をfs・Honoに依存しない経路定義と照合の境界とする。
  `packages/routes/src/node.ts`だけがファイルを走査し、サーバー専用のfile pathを持つ表を作る。
- 静的経路を動的経路より先に照合し、同じ動的位置の衝突は対象ファイルを示して拒否する。
  末尾斜線、検索引数、fragment、percent encodingの規則は共有照合関数へ集約する。
- `irisout/hono`は走査したpageを既存SSR targetへコンパイルし、Honoのサブルーターへ登録する。
  `prefix`をserverとViteへ同じ値で渡す。loaderは要求ごとにparams、URLSearchParams、raw Requestを
  受け取り、JSON結果だけをrender入力へ渡す。not-found、redirect、errorは正常page stateから分離する。
- `irisout/vite`の`irisoutRoutes()`は同じpage群をclient targetで仮想moduleへ生成する。
  ブラウザーへはclient経路表とhydrate用page moduleだけを送り、初回stateは文書内の
  `data-irisout-route-state` scriptから一度だけ読む。
- リンク・履歴の処理は同一生成元の通常操作だけを管理し、遷移の世代番号と旧instanceの
  `unmount()`で競合と副作用を止める。取得または描画に失敗した場合は標準の文書遷移へ戻す。
- HTML文書の外枠は利用側が組み立てる。利用側はdocument rendererの`stateScript`を初期文書へ置く。

## 検討した代替案

- **Honoのmatcherをブラウザーでも使う**: HonoとNodeの依存をclientへ持ち込み、URL正規化の契約を
  共通化できないため採用しない。
- **pageごとに別の経路定義を書く**: serverとclientの優先順位・復号のずれを許すため採用しない。
- **全URLをcatch-allでclientへ送る**: 外部リンク、download、別tab、fragmentの標準動作を壊すため、
  client側で管理対象を先に判定する。
- **loaderをclientへ同梱する**: Request、接続情報、server依存をブラウザーへ搬送し、初期stateの
  秘密境界を壊すため採用しない。

## 結果

一つの`page.jsx`集合からHonoサブルーターとclient経路表を作れる。既存の単一部品SSRと
`irisout/vite`の入口は維持し、ファイル経路機能は`irisout/hono`、`irisout/routes`、
`irisoutRoutes`として追加した。入れ子layout、catch-all、先読み、状態保持、APIの自動登録は対象外である。

---
