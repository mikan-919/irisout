# npm公開版から始める

この手順は、空のディレクトリへ`irisout` 0.1.1を導入し、JSXの型検査、開発サーバー、
本番ビルドを確認するまでを扱う。irisoutのソースリポジトリやworkspaceは使用しない。

必要なものはNode.js、npm、Gitである。Bunを使う場合は、以下の`npm`を`bun`、
`npm run`を`bun run`へ置き換えられる。

## 1. パッケージを導入する

```sh
mkdir irisout-app
cd irisout-app
npm init -y
npm install irisout@0.1.1 vite-plus@0.3.0
npm install --save-dev typescript@5.9
```

`package.json`へ`type`と実行コマンドを追加する。

```json
{
  "type": "module",
  "scripts": {
    "dev": "vp dev",
    "build": "vp build",
    "typecheck": "tsc --noEmit"
  }
}
```

注: `vite-plus`は開発サーバー、JSX変換、本番ビルドを行う開発道具である。
0.1.1で確認済みの組み合わせは`vite-plus` 0.3.0とTypeScript 5.9である。

## 2. ファイルを作る

次の構成でファイルを作る。

```text
irisout-app/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── App.jsx
    └── main.js
```

`index.html`:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>irisout app</title>
  </head>
  <body>
    <div id="app"><!--irisout-html--></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

注: `<!--irisout-html-->`は、ビルド時に生成した初期HTMLを挿入する位置である。

`vite.config.ts`:

```ts
import { defineConfig } from 'vite-plus'
import { irisout } from 'irisout/vite'

export default defineConfig({
  plugins: [irisout({ entry: 'src/App.jsx', container: '#app' })],
})
```

`src/main.js`:

```js
import 'virtual:irisout-entry'
```

注: `virtual:irisout-entry`は、irisoutが生成したブラウザ用JavaScriptをVite+へ渡す
仮想モジュールである。実体ファイルを作る必要はない。

`src/App.jsx`:

```jsx
export function App() {
  const count = signal(0)
  const doubled = derived(() => count() * 2)

  render(
    <main>
      <output>
        {count()} / {doubled()}
      </output>
      <button type="button" onClick={increment}>
        増加
      </button>
    </main>,
  )

  function increment() {
    count(count() + 1)
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": true,
    "checkJs": true,
    "jsx": "preserve",
    "types": ["irisout/jsx"],
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "strict": false
  },
  "include": ["src/**/*.jsx"]
}
```

型検査はirisoutが解析する`.jsx`だけを対象にする。これにより、Vite設定用のNode.js型や
仮想モジュールの型宣言をアプリのJSX検査へ混ぜない。

## 3. 検査して起動する

```sh
npm run typecheck
npm run build
npm run dev
```

開発サーバーが表示したURLを開き、`増加`を押す。表示が`0 / 0`から`1 / 2`へ変われば、
イベントと状態更新が動いている。本番ビルドの出力は`dist/`に作られる。

## 記述時の制約

- `signal`、`derived`、`collection`、`render`は取り込まない。コンパイラが認識する記述用APIである。
- ルート部品は一つにし、状態宣言を`render()`より前、イベント処理を後へ置く。
- 繰り返しは直接の`.map()`、条件分岐は三項演算子または`&&`で記述する。
- `try`、`for`、`switch`など、更新位置を静的に決められない制御構文は拒否される場合がある。
- 未対応構文は`compile: ... (scope limit)`として、ファイル、行、列とともに表示される。

対応機能と制約の全体は[`STATUS.md`](../STATUS.md)を参照する。不具合を報告するときは、
元のJSX、生成物、`irisout`とブラウザの版、再現手順を残す。

## 初期HTMLの範囲

通常の要素と、ビルド時に評価できるテキストや属性は`dist/index.html`へ入る。一方、
`.map()`のリストと三項演算子または`&&`の条件分岐は、開始・終了を示すコメントだけを
初期HTMLへ入れ、ブラウザで初期化するときに内容を挿入する。

```jsx
render(
  <main>
    {visible() && (
      <ul>
        {items().map((item) => (
          <li>{item.label}</li>
        ))}
      </ul>
    )}
  </main>,
)
```

この例では`main`と構造範囲のコメントが初期HTMLへ入り、`ul`と`li`はブラウザで
`hydrate`するときに作られる。`hydrate`は、初期HTMLの要素へイベントと状態更新を
接続する処理である。irisout 0.1.1は要求ごとに全画面のHTMLを生成するサーバー描画を
提供しないため、JavaScript実行前からリストや条件分岐の内容が必要な用途には使えない。

## 破棄を確認する

条件分岐やリストから要素を外したときの破棄は、`use=`が返す`destroy`で確認できる。

```jsx
export function App() {
  const visible = signal(true)

  render(
    <main>
      <button type="button" onClick={toggle}>
        切り替え
      </button>
      {visible() && <p use={observe}>破棄対象</p>}
    </main>,
  )

  function toggle() {
    visible(!visible())
  }

  function observe(element) {
    console.log('初期化', element)
    return {
      destroy() {
        console.log('破棄', element)
      },
    }
  }
}
```

開発者道具のコンソールを開いて`切り替え`を押す。段落が消えるときに`破棄`が一度だけ
表示されれば、条件分岐が所有する処理は解放されている。キー付きリストでは、項目を削除
したときも同じ方法で確認できる。

生成部品自体は`unmount()`を持つが、0.1.1の`irisout/vite`は仮想モジュールを読み込むと
自動で`hydrate`し、その戻り値をアプリへ公開しない。このため、通常のVite+入口から
ルート部品の`unmount()`を呼ぶ方法は公開契約に含まれない。上の確認は条件分岐または
リストが所有する範囲の破棄を対象とし、ルート部品全体の破棄試験ではない。
