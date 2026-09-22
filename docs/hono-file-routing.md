---
title: Honoとpage.tsxのファイル経路
description: page.tsx、loader、要求単位SSR、ブラウザー遷移を設定する
slug: hono-routing
section: API
order: 2
---

# Honoとpage.tsxのファイル経路

`irisout/hono`は`page.tsx`または`page.jsx`のディレクトリ構造をHonoのサブルーターへ接続する。Vite側で`irisoutRoutes`を使うと、同じ経路表で初回hydrateとブラウザー遷移を行う。

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
  render(<main><h1>{name}</h1></main>)
}
```

## Honoへ接続する

```ts
import { Hono } from 'hono'
import { createFileRouter, notFound } from 'irisout/hono'

const app = new Hono()

app.route('/', createFileRouter('./routes', {
  loaders: {
    '/users/:id': async ({ params }) => {
      const user = await findUser(params.id)
      return user ? { name: user.name } : notFound()
    },
  },
  document: ({ html, stateScript }) =>
    `<!doctype html><div id="app">${html}</div>${stateScript}`,
}))
```

loaderの戻り値はJSONで表せる値に限る。`request`はloader内で利用できるが、ブラウザへ渡すstateには含まれない。別URLへ移す場合は`redirect(location, status)`を返す。

## Viteへ接続する

```ts
import { defineConfig } from 'vite-plus'
import { irisoutRoutes } from 'irisout/vite'

export default defineConfig({
  plugins: [irisoutRoutes({ directory: './routes' })],
})
```

`prefix`を使う場合はHono側とVite側へ同じ値を渡す。通常の同一配信元リンクはクライアント遷移の対象になり、外部リンク、別タブ、download、fragmentだけの移動はブラウザ標準の動作へ任せる。
