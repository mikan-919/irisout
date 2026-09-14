# irisout

JSXから静的HTMLと直接DOM更新コードを生成する開発基盤です。

```bash
npm install irisout vite-plus
```

Vite連携は`irisout/vite`、JSX型定義は`irisout/jsx`から参照します。

```ts
import { irisout } from 'irisout/vite'
```

要求単位のSSRは`irisout/ssr`の`irisoutSsr()`でルート部品を明示して使います。生成された
`render(input)`はHTMLとhydrate用stateを返し、stateをscriptへ埋め込むときは
`serializeSsrState()`を使います。SSR生成物の`hydrateComponent(container, state)`と
`mountComponent(container, state)`には`render()`が返したstateを渡します。初期SSRは単一module入口に
限り、構造unit内の`signal()`と`derived()`は対象外です。

```ts
import { irisoutSsr, serializeSsrState } from 'irisout/ssr'
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
