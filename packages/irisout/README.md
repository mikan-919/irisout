# irisout

JSXから静的HTMLと直接DOM更新コードを生成する開発基盤です。

```bash
npm install irisout vite-plus
```

ファイル経路を使う場合は`hono`も導入します。

```bash
npm install irisout vite-plus hono
```

Vite連携は`irisout/vite`、JSX型定義は`irisout/jsx`から参照します。

```ts
import { irisout } from 'irisout/vite'
```

Motionを使う場合は`motion`を導入し、Vite設定だけをMotion用入口へ替えます。

```bash
npm install irisout motion vite-plus
```

```ts
import { irisoutMotion } from 'irisout/motion/vite'

export default { plugins: [irisoutMotion({ entry: './src/App.jsx' })] }
```

JSXでは`irisout/motion`の`motion`を使います。`layout`、`layoutId`、`initial`、`animate`、`transition`を
Motionへ接続します。`layout="position"`、`layout="size"`、`layoutScroll`、`layoutRoot`、
`layoutCrossfade`も指定できます。配置測定、親子補正、共有要素、スクロール補正、割り込み、
角丸と影の拡縮補正はMotionの配置投影エンジンを使います。`AnimatePresence`内の条件分岐または
キー付き一覧から要素を外すときは`exit`を使えます。退場は`mode="sync"`に限ります。
`variants`とgesture属性は未対応で、通常のDOM属性として残さずコンパイル前にエラーにします。

```jsx
import { motion } from 'irisout/motion'
import { render } from 'irisout'

export function Card() {
  render(<motion.div layout layoutId="card" animate={{ opacity: 1 }} />)
}
```

```jsx
import { AnimatePresence, motion } from 'irisout/motion'
import { render, signal } from 'irisout'

export function Toggle() {
  const visible = signal(true)
  render(
    <main>
      <AnimatePresence mode="sync">
        {visible() && <motion.div exit={{ opacity: 0 }} />}
      </AnimatePresence>
    </main>,
  )
}
```

JSXの記述APIは`irisout`から名前付きでimportします。このimportはコンパイル時に
取り除かれ、生成物の実行時依存にはなりません。

```jsx
import { render, signal } from 'irisout'

export function Counter() {
  const count = signal(0)
  render(<button onClick={() => count(count() + 1)}>{count()}</button>)
}
```

Playgroundなどブラウザ内で単一JSXを変換する場合は`irisout/browser`を使います。入力は
ソース文字列だけで、ファイル読込み、module解決、外部資源importは行いません。

```ts
import { compile } from 'irisout/browser'

const result = compile(source)
```

対応外のimportや構文は`compile:`で始まるscope limit診断になります。投稿されたsourceを
サーバーへ渡さず、Workerなどの隔離した実行単位から呼び出してください。

要求単位のSSRは`irisout/ssr`の`irisoutSsr()`でルート部品を明示して使います。生成された
`render(input)`はHTMLとhydrate用stateを返し、stateをscriptへ埋め込むときは
`serializeSsrState()`を使います。SSR生成物の`hydrateComponent(container, state)`と
`mountComponent(container, state)`には`render()`が返したstateを渡します。初期SSRは単一module入口に
限り、構造unit内の`signal()`と`derived()`は対象外です。

```ts
import { irisoutSsr, serializeSsrState } from 'irisout/ssr'
```

`page.tsx`または`page.jsx`のディレクトリ構造からHonoのサブルーターとブラウザー遷移を作る場合は、
`irisout/hono`で経路を作り、`irisout/hono/vite`で同じHono appをViteへ渡します。Honoの登録済み経路がSSOTになります。

```ts
// サーバー設定
import { Hono } from 'hono'
import { createFileRouter } from 'irisout/hono'

export const app = new Hono()
app.route('/apps', createFileRouter('./routes'))
```

```ts
// Vite設定
import { irisoutHono } from 'irisout/hono/vite'
import { app } from './server/app.ts'

export default { plugins: [irisoutHono(app)] }
```

loaderは`loaders`へ経路をキーとして登録できます。HTML文書の外枠は利用側が組み立て、
初期stateはdocument関数の`stateScript`を使います。`notFound()`と`redirect()`はloaderから返せます。

```ts
createFileRouter('./routes', {
  loaders: {
    '/users/:id': async ({ params, search, request }) => ({
      name: await loadUser(params.id!, search, request),
    }),
  },
  document: ({ html, stateScript }) => `<!doctype html><div id="app">${html}</div>${stateScript}`,
})
```

```json
{
  "compilerOptions": {
    "types": ["irisout/jsx"]
  }
}
```

コンパイラは`irisout`、診断型は`irisout/diagnostics`から参照できます。

版ごとの差分は[`CHANGELOG.md`](./CHANGELOG.md)を参照してください。
