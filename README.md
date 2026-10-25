# irisout

[![npm version](https://img.shields.io/npm/v/irisout?color=6549d8)](https://www.npmjs.com/package/irisout)
[![MIT License](https://img.shields.io/github/license/mikan-919/irisout?color=20b5c7)](LICENSE)

JSXをビルド時に解析し、初期HTMLと、状態変更を実DOMへ反映するJavaScriptを生成するコンパイラです。静的に決まるDOMをHTMLへ出し、テキストや属性の更新先をコンパイル時に決めます。仮想DOMは使いません。条件分岐や一覧など、実行時に決まる構造には、その機能が使う処理を生成します。

React互換の実行環境ではありません。対応するJSXとJavaScriptの範囲をコンパイル時に検査し、扱えない構文は位置を示して診断します。

| 目的                                   | 入口                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| npm公開版で新しいアプリを作る          | [npm公開版から始める](./docs/getting-started.md)                                              |
| 公開パッケージの入口と記述方法を調べる | [パッケージ README](./packages/irisout/README.md)、[APIリファレンス](./docs/api-reference.md) |
| デモや文書サイトを起動する             | [ワークスペースを使う](#ワークスペースを使う)                                                 |
| 対応範囲と制約を確認する               | [診断と対応範囲](./docs/diagnostics-and-limits.md)                                            |

## 目次

[コンパイル結果](#コンパイル結果) · [npmで試す](#動作を試す) · [生成の仕組み](#ビルドとブラウザーでの処理) · [機能](#機能) · [対応範囲](#対応範囲) · [開発](#ワークスペースを使う) · [検査](#検査と構築) · [文書](#文書と設計) · [ライセンス](#ライセンス)

## コンパイル結果

公開APIの[`compile(source)`](./docs/api-reference.md#コンパイラ)に単一ソースを渡したときの結果です。初期HTMLにはボタンと初期値が入り、生成JavaScriptには`count`の変更をボタン内のテキストへ反映する関数が含まれます。

```js
import { compile } from 'irisout'

const result = compile(
  'export function App() { const count = signal(0); render(<button type="button" onClick={increment}>{count()}</button>); function increment() { count(count() + 1) } }',
)
```

`result.initialHtml`:

```html
<button type="button" data-iris-id="m0">0</button>
```

`result.code`内の更新関数を整形して抜粋:

```js
function update_count() {
  // 中略
  {
    const __el = __markers__.get('m0')
    if (__el) {
      __el.textContent = `${count}`
    }
  }
  // 中略
}
```

これはコンパイラが返したHTMLとJavaScriptの抜粋で、ブラウザー画面の画像ではありません。この単一ソース例では記述API名を直接認識します。Vite+でアプリを作るときは、通常どおり`irisout`から`signal`や`render`を名前付きでimportします。

## 動作を試す

公開版0.3.7、Vite+ 0.3.0、TypeScript 5.9を使う例です。Node.jsとnpmを用意し、アプリのディレクトリでパッケージを導入します。

```sh
mkdir irisout-app
cd irisout-app
npm init -y
npm install irisout@0.3.7 vite-plus@0.3.0
npm install --save-dev typescript@5.9
```

`package.json`に実行コマンドを追加します。

```json
{
  "type": "module",
  "scripts": {
    "dev": "vp dev",
    "build": "vp build"
  }
}
```

`index.html`に初期HTMLの差し込み位置を置きます。`<!--irisout-html-->`をビルド時のHTMLで置き換えます。

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <title>irisout app</title>
  </head>
  <body>
    <div id="app"><!--irisout-html--></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

Vite+設定では、コンパイルするルート部品と対象要素を指定します。

```ts
import { defineConfig } from 'vite-plus'
import { irisout } from 'irisout/vite'

export default defineConfig({
  plugins: [irisout({ entry: 'src/App.jsx', container: '#app' })],
})
```

`src/main.js`から仮想モジュールを読み込みます。仮想モジュールはirisoutが生成するブラウザー用コードへの入口で、実ファイルは作りません。

```js
import 'virtual:irisout-entry'
```

JSXの型検査も行う場合は、`tsconfig.json`の`types`に`irisout/jsx`を指定し、対象を`src/**/*.jsx`にします。TypeScriptの導入を含む全設定は[導入手順](./docs/getting-started.md)にあります。

`src/App.jsx`では、状態を`signal`、状態から計算する値を`derived`、表示するJSXを`render`で宣言します。

```jsx
import { derived, render, signal } from 'irisout'

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

`npm run build`、`npm run dev`を実行します。開発サーバーで「増加」を押すと、表示は`0 / 0`から`1 / 2`へ変わります。型検査を含む完全なファイル配置と設定は[導入手順](./docs/getting-started.md)にあります。

## ビルドとブラウザーでの処理

| 入力                            | ビルド時の処理                     | ブラウザーでの処理                                         |
| ------------------------------- | ---------------------------------- | ---------------------------------------------------------- |
| 静的なJSX、文字列、属性         | 初期HTMLへ出力                     | 初期HTMLを再利用                                           |
| `signal()`と`derived()`の読取り | 読取りと更新先を解析               | 対応するテキストや属性を更新                               |
| DOMイベント                     | ハンドラーと書込み対象を解析       | ブラウザー標準のイベントを受け、書込み後に必要な表示を更新 |
| 条件分岐と`.map()`の一覧        | 構造範囲を記録し、必要な処理を選択 | 分岐や一覧の追加・更新・削除を管理                         |

Vite連携の初期HTMLには、ビルド時に決まる要素や属性が入ります。三項演算子、`&&`、`.map()`で書く動的構造は範囲の印だけを置き、初期化時にブラウザーで内容を作ります。`hydrate`はそのHTMLへイベントと状態更新を接続する処理です。要求ごとのデータに基づくHTMLや、JavaScript実行前に動的構造を含める必要がある場合は、[SSRとHono連携](#サーバー描画と経路)を使います。

`signal`、`derived`、`render`などの記述APIは、コンパイル時に解析され、生成物から取り除かれます。実行時処理がすべてなくなるわけではありません。キー付き一覧、条件分岐、部品の初期化と破棄には共有処理が使われます。

## 機能

### 状態とDOM更新

- `signal(initial)`は読み出しと書込みを行う状態を作ります。更新関数を渡して直前の値から次の値を計算できます。
- `derived(compute)`は他の状態から計算する読み取り専用値です。
- `onClick`や`onInput`などのイベント属性でハンドラーを接続します。状態の書込み先が静的に分かる範囲では、コンパイラがDOM更新コードを生成します。
- `onMount(callback)`はDOM接続後に一度実行します。`effect(callback)`は読んだ状態の変更後に再実行し、再実行前と破棄時に後始末関数を呼びます。
- `use={action}`は実DOM要素を受け取り、必要に応じて`update`と`destroy`を返します。条件分岐や一覧から要素が外れると、所有する後始末を実行します。
- JSX属性では`class`、`data-*`、`aria-*`などを使えます。`key`は一覧内の項目を識別し、DOM属性にはなりません。

### JSX、部品、構造

- 三項演算子または`&&`で条件分岐を書きます。分岐の入れ替えでは、古いDOM範囲を破棄して新しい範囲を作ります。
- 状態を直接`.map()`して一覧を作り、項目の安定した識別子を`key`にします。`key`はHTML属性ではなく、DOMと項目ごとの状態を再利用するための識別子です。
- 同じファイルの部品と、相対`import`した`.js`、`.jsx`、`.ts`、`.tsx`の部品を組み合わせられます。部品への入力（props）は分割代入で受け取り、直接の子位置では`children`を使えます。
- 部品は`render(<JSX>)`を呼ぶ形式か、`return <JSX>`を返す形式で宣言します。一つの部品の中では併用しません。

```jsx
import { render } from 'irisout'

function Badge({ label }) {
  return <span class="badge">{label}</span>
}

export function App() {
  render(<Badge label="準備完了" />)
}
```

- `createContext`と`provideContext`で値を子孫へ渡し、`useContext`で最も近い値を読みます。`createAsyncContext`はPromise形式の初期値を持つコンテキストを作ります。
- SVG要素を記述できます。通常の動的属性はDOMの属性更新へ変換します。`xlink:*`など名前空間付き属性は静的文字列に限ります。

### コンパイラと開発連携

- `irisout/vite`はVite+へコンパイラを接続し、初期HTMLとブラウザー用モジュールを構築します。
- `irisout/browser`の`compile(source)`はブラウザー内でソース文字列一つを変換します。ファイル読込み、相対importの解決、外部モジュールの読込みは行いません。利用者が入力したコードを扱う場合はWorkerなどへ処理を分けます（この入口自体は実行コードの隔離環境ではありません）。
- Node.jsの`compile()`と`compileProject()`は、生成コード、ソースマップ、初期HTML、依存ファイルなどを返します。
- `irisout/diagnostics`は診断の型を公開します。対応外の構文はファイル名、行、列を含む`compile: ... (scope limit)`として報告します。
- `listEvents: 'direct' | 'delegated'`を指定できます。既定の`direct`は各要素へイベントを登録します。`delegated`は平坦な一覧内の引数なし`onClick`を親要素で処理します。`currentTarget`や伝播停止、外部リスナーとの順序に差が出るため、指定前に[APIの説明](./docs/api-reference.md#コンパイラ)を確認してください。

### サーバー描画と経路

- `irisout/ssr`はルート部品を明示した要求単位のサーバー側レンダリングを行います。`render(input)`はHTMLとhydrate用の状態を返し、`serializeSsrState()`で状態をscript要素へ安全に埋め込めます。サーバーではイベント、ライフサイクル、`use`アクションを実行しません。
- `irisout/hono`の`createFileRouter()`は`page.jsx`または`page.tsx`のディレクトリをHonoのサブルーターへ接続します。loaderからページ用データ、404、リダイレクトを返せます。
- `irisout/hono/vite`は同じHonoアプリの経路をVite+へ渡し、初回のSSRとブラウザーのページ遷移へ接続します。経路はHonoへの登録を正本として扱います。
- 任意機能の`irisout/motion`と`irisout/motion/vite`は`motion`パッケージと連携します。`layout`、`layoutId`、`initial`、`animate`、`transition`と、`AnimatePresence`内の`exit`を扱います。退場は`mode="sync"`に限り、`variants`とジェスチャー属性は未対応です。

Vite連携には`vite-plus >=0.3.0`、Honoのファイル経路には`hono >=4.0.0`が必要です。Motion連携は任意依存の`motion 13.4.x`を使います。導入例は[パッケージ README](./packages/irisout/README.md)にあります。

入口ごとの設定、戻り値、例は[APIリファレンス](./docs/api-reference.md)、[ライフサイクルとコンテキスト](./docs/lifecycle-and-context.md)、[Honoとファイル経路](./docs/hono-file-routing.md)を参照してください。

## 対応範囲

irisoutは任意のReactコードやJavaScriptを実行時に解釈する仕組みではありません。コンパイラが状態の読取りと書込み先を決められない構文は受理しません。代表的な記述規則は次のとおりです。

- ルート部品は一つにし、状態宣言を`render()`より前、イベントやライフサイクルを後に置きます。
- 繰り返しは状態へ直接`.map()`し、各項目に安定した`key`を指定します。条件分岐は三項演算子または`&&`を使います。
- 再帰部品、部品を値として動的に受け渡す形式、循環モジュールは扱いません。
- ブラウザー内コンパイラは一つのソース文字列だけを扱い、モジュール解決を行いません。
- Motion拡張の未対応属性は通常のDOM属性として残さず、コンパイル時に診断します。

制約は公開版と未公開のソース変更で異なる場合があります。公開版0.3.7の制約、回避方法、診断例は[診断と対応範囲](./docs/diagnostics-and-limits.md)と[導入手順](./docs/getting-started.md)を確認してください。実装状況は[STATUS.md](./STATUS.md)に記録しています。

## ワークスペースを使う

新しいアプリを作る人はnpm公開版を使います。irisout本体、デモ、文書サイトを開発する場合は、このリポジトリのBunワークスペースを使います。ルートの`package.json`はBun 1.3.13を指定しています。

ルートは非公開の開発用ワークスペースです。npmへ公開する`irisout`パッケージは`packages/irisout/`にあります。

```sh
git clone https://github.com/mikan-919/irisout.git
cd irisout
bun install
bun run dev
```

`bun run dev`はCounterデモを起動します。別のデモは次のコマンドで選びます。

```sh
bun run dev demo list
bun run dev demo notes
bun run dev demo heatmap
bun run dev demo todomvc
bun run dev demo multi-file
```

`bun run dev site`は文書サイトを構築して起動し、`bun run dev playground`はPlaygroundを起動します。主な作業場所は次のとおりです。

| 場所                                                        | 内容                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| `packages/compiler/`、`packages/runtime/`、`packages/hono/` | コンパイラ、実行時処理、Hono連携のソース                 |
| `packages/irisout/`                                         | npmへ公開する単一パッケージと、そのREADME・変更履歴      |
| `apps/demos/`                                               | Counter、一覧、Notes、Heatmap、TodoMVC、複数ファイルの例 |
| `apps/web/`                                                 | 文書サイト、例、Playground                               |
| `packages/bench/`                                           | 測定コードと結果                                         |
| `fixtures/`                                                 | 導入先を模したアプリと再現例                             |

## 検査と構築

変更を確認するときは、用途に応じて次を実行します。

```sh
bun run check
bun run test
bun run build
bun run build:web
bun run build:packages
bun run pack:smoke
```

`check`は静的検査とTypeScriptの型検査、`test`はリポジトリの試験、`build`はデモ、`build:web`は文書サイト、`build:packages`は公開パッケージを構築します。`pack:smoke`は梱包したパッケージを一時的な別アプリへ導入し、型検査と構築を確認します。

保存済みDOM操作をChromiumで確認する場合は、実行ファイルのパスを指定します。

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium bun run test:browser
```

結果のJSON、ログ、失敗画像は`.artifacts/browser-checks/run-*/`へ保存されます。保存先は`IRISOUT_BROWSER_ARTIFACTS`で変更できます。

## 文書と設計

利用者向け文書の一覧は[docs/README.md](./docs/README.md)にあります。設計方針は[CONCEPT.v3.md](./CONCEPT.v3.md)、内部構造は[アーキテクチャ](./docs/architecture.md)、実装状況と制約は[STATUS.md](./STATUS.md)、今後の作業は[ROADMAP.md](./ROADMAP.md)を参照してください。決定済みの設計は[ADR](./docs/adr/)、受け入れ条件は[OpenSpec仕様](./openspec/specs/)にあります。測定結果と測定コードは[`packages/bench/`](./packages/bench/)にあります。

## ライセンス

[MIT License](./LICENSE)
