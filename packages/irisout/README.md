# irisout

JSXから静的HTMLと直接DOM更新コードを生成する開発基盤です。

```bash
npm install irisout vite-plus
```

Vite連携は`irisout/vite`、JSX型定義は`irisout/jsx`から参照します。

```ts
import { irisout } from 'irisout/vite'
```

```json
{
  "compilerOptions": {
    "types": ["irisout/jsx"]
  }
}
```

コンパイラは`irisout`、診断型は`irisout/diagnostics`から参照できます。
