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
import { render } from 'irisout'

export function UserPage({ name }) {
  render(
    <main>
      <h1>{name}</h1>
    </main>,
  )
}
```

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
    document: ({ html, stateScript }) => `<!doctype html><html><body><div id="app">${html}</div>${stateScript}<script type="module" src="/irisout-client.js"></script></body></html>`,
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
})
```

経路ディレクトリと接頭辞はHono側だけに書く。`irisoutHono(app)`は`createFileRouter()`由来の経路だけを選び、HonoのAPI経路は無視する。app定義はVite設定からも読み込まれるため、`Bun.serve()`などの待受開始は別の起動ファイルに置く。

各ページは動的`import()`になる。irisoutは経路表とページ入口だけを生成し、チャンク分割、共有チャンク、圧縮、ファイル名のハッシュはViteが処理する。通常の同一配信元リンクはクライアント遷移の対象になり、外部リンク、別タブ、download、fragmentだけの移動はブラウザー標準の動作へ任せる。

`irisoutHono(app)`はブラウザー入口を`irisout-client.js`として自動的に発行する。利用側のJavaScriptから`virtual:*`をimportする必要はない。利用側は`document`へ`<script type="module" src="/irisout-client.js"></script>`を含める。プラグインは入口ファイルを生成するが、HTML文書へscript要素は挿入しない。Honoの`document`は差し込みコメントを持つHTMLテンプレートではなく、`html`、`stateScript`とVite生成資産を使って完成したHTML文書を返せる。

開発時はViteのHMR clientをHTMLへ挿入する。既存ページの変更はViteのmodule更新として受け取り、現在表示中のページをHonoのSSR結果から再hydrateする。ページ内の`signal`状態はSSR初期値へ戻る。ページの追加・削除は経路表を作り直すため、開発サーバーを再起動して文書全体を再読み込みする。
