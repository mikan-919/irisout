---
title: Honoとpage.tsxのファイル経路
description: page.tsx、loader、要求単位SSR、ブラウザー遷移を設定する
slug: hono-routing
section: API
order: 2
---

# Honoとpage.tsxのファイル経路

`irisout/hono`は`page.tsx`または`page.jsx`のディレクトリ構造をHonoのサブルーターへ接続する。`irisout/hono/vite`はHonoへ登録された経路をSSOTとして読み、初回hydrateとブラウザー遷移に必要な生成物をViteへ渡す。

## 経路を作る

```text
routes/
├── page.tsx
├── about/
│   └── page.tsx
└── users/
    └── [id]/
        └── page.tsx
```

この構成は`/`、`/about`、`/users/:id`になる。各pageは入力をpropsとして受け取るルート部品を公開する。

```tsx
// Layout.tsx
export function Layout({ title, children }) {
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <title>{title}</title>
      </head>
      <body>{children}</body>
    </html>
  )
}
```

```tsx
// routes/users/[id]/page.tsx
import { Layout } from '../../../Layout.tsx'

export function UserPage({ name }) {
  return (
    <Layout title={name}>
      <main>
        <h1>{name}</h1>
      </main>
    </Layout>
  )
}
```

`Layout`はJSX部品として使う。展開後のルートが`<html>`なら文書ページになり、`<head>`、`<body>`の順で記述する。タイトル、メタデータ、文書属性はJSXで指定できる。`createFileRouter()`の`document`指定は不要で、ルーターが文書型宣言と状態、起動用のJavaScriptを加える。

## Honoへ接続する

```ts
import { Hono } from 'hono'
import { createFileRouter, notFound } from 'irisout/hono'

export const app = new Hono()

app.route(
  '/',
  createFileRouter('./routes', {
    loaders: {
      '/users/:id': async ({ params }) => {
        const user = await findUser(params.id)
        return user ? { name: user.name } : notFound()
      },
    },
  }),
)
```

loaderの戻り値はJSONで表せる値に限る。`request`はloader内で利用できるが、ブラウザへ渡すstateには含まれない。別URLへ移す場合は`redirect(location, status)`を返す。

## Viteへ接続する

```ts
import { defineConfig } from 'vite-plus'
import { irisoutHono } from 'irisout/hono/vite'
import { app } from './server/app.ts'

export default defineConfig({
  plugins: [
    irisoutHono(app),
    // 通常のViteプラグインを続けて登録できる。
  ],
  build: { rollupOptions: { input: {} } },
})
```

経路ディレクトリと接頭辞はHono側だけに書く。`irisoutHono(app)`は`createFileRouter()`由来の経路だけを選び、HonoのAPI経路は無視する。app定義はVite設定からも読み込まれるため、`Bun.serve()`などの待受開始は別の起動ファイルに置く。

各ページは動的`import()`になる。irisoutは経路表とページ入口だけを生成し、チャンク分割、共有チャンク、圧縮、ファイル名のハッシュはViteが処理する。通常の同一配信元リンクはクライアント遷移の対象になり、外部リンク、別タブ、download、fragmentだけの移動はブラウザー標準の動作へ任せる。

`irisoutHono(app)`はブラウザー入口を`irisout-client.js`として発行する。文書ページではHonoが状態のJSONと`<script type="module" src="/irisout-client.js"></script>`を`</body>`直前へ挿入する。利用側で仮想モジュールをimportしたり、起動scriptを書いたりする必要はない。

注: `input: {}`はViteの既定入口`index.html`を使わない指定である。HTMLはHonoが要求ごとに返し、プラグインがブラウザー入口を発行する。この指定を省くと、`index.html`のない構成では本番構築が`Cannot resolve entry module index.html`で止まる。構築されたJavaScriptの配信は、利用側のHTTPサーバーへ接続する。

初回はサーバーが描画した`<html>`を再利用してイベント処理と状態更新を接続する。文書間の遷移では`head`、`body`、`html`属性を更新する。独自の実行可能な`script`を含む文書への遷移はブラウザーの文書読み込みへ委ねる。

既存の`document: ({ html, stateScript }) => ...`指定も使える。この指定でHTMLを組み立てる場合は、状態と起動scriptを利用側で挿入する。文書ページと`#app`内の部分ページを混在させ、文書ページから部分ページへ移る場合も文書を読み込む。

開発時はViteのHMR clientをHTMLへ挿入する。`irisout-client.js`を読み込む文書では、既存ページの変更をViteのmodule更新として受け取り、現在表示中のページをHonoのSSR結果から再hydrateする。ページ内の`signal`状態はSSR初期値へ戻る。`irisout-client.js`を読み込まないSSR専用文書では、ページの変更時に文書全体を再読み込みする。ページの追加・削除は経路表を作り直すため、開発サーバーを再起動して文書全体を再読み込みする。

## 開発時のAPIを接続する

`irisoutHono(app)`が開発時に配信するのは、登録済みのページへのGET要求だけである。同じHonoアプリに定義したAPIも、別に接続しない限りViteのURLでは404になる。

次は、本文を使わない検索GETと状態変更POSTを`/api/`以下に置く場合の接続例である。Vite設定の`plugins`へ、`irisoutHono(app)`とともに追加する。

```ts
const apiDevelopment = {
  name: 'hono-api-development',
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (!request.url?.startsWith('/api/')) return next()
      try {
        const result = await app.fetch(
          new Request(new URL(request.url, 'http://localhost'), {
            method: request.method,
          }),
        )
        response.statusCode = result.status
        result.headers.forEach((value, name) => response.setHeader(name, value))
        response.end(await result.text())
      } catch (error) {
        next(error)
      }
    })
  },
}
```

注: この例は本文、認証用の要求ヘッダー、バイナリー応答を転送しない。それらが必要なAPIではHTTPアダプターを使うか、別のAPIサーバーへのViteの`server.proxy`を設定する。メモリ上のデータをloaderとAPIで共有する場合、この例のように同じ`app`を使う。別プロセスへ中継すると、メモリは共有されない。
