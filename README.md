# irisout

![irisout](./docs/assets/logo.webp)

**JSXから、静的HTMLと状態ごとのDOM更新コードを生成するUIコンパイラです。**

```text
JSX → ビルド → 静的HTML + DOM更新コード
                         └ 仮想DOMなし
```

irisoutは、JSXの記述方法を保ちながら、ブラウザで動く処理をUIに必要な範囲へ
限定します。コンポーネント、状態の依存関係、更新先をビルド時に解析し、実DOMを
更新するコードへ変換します。

> [!WARNING]
> `irisout` 0.2.2をnpmで公開しています。試用版のため、対応範囲を確認してください。
> 実製品へ導入する場合は、対応範囲と依存パッケージのライセンスを確認してください。

## 30秒で把握する

次のJSXを記述します。

```jsx
export function Counter() {
  const count = signal(0)
  const doubled = derived(() => count() * 2)

  render(
    <div>
      <p>
        count: {count()} / doubled: {doubled()}
      </p>
      <button type="button" onClick={increment}>
        increment
      </button>
    </div>,
  )

  function increment() {
    count(count() + 1)
  }
}
```

ビルド結果は次の役割に分かれます。

| 結果              | 役割                                             |
| ----------------- | ------------------------------------------------ |
| `dist/index.html` | 初期表示のHTMLを保持する                         |
| `dist/app.js`     | クリック処理と、`count`に依存するDOMの更新を行う |

`signal`、`derived`、`render`は記述用APIです。コンパイラが意味を解析するための
構文であり、同じ形の実行時APIをブラウザへ送るものではありません。リストや条件分岐
など、実行時の管理が必要な機能だけが共有処理を使用します。

## 5分で試す

空のディレクトリへnpm公開版を導入してアプリを作る場合は、
[`npm公開版から始める`](./docs/getting-started.md)に従ってください。必要なファイル、
型検査、開発サーバー、本番ビルドまでを一続きで記載しています。

irisoutのソースリポジトリにある利用例を動かす場合は、次を実行します。

```bash
git clone https://github.com/mikan-919/irisout.git
cd irisout
bun install
bun run dev
```

端末に表示されたURLをブラウザで開き、`increment`を押してください。ソースは
[`apps/demos/counter.jsx`](./apps/demos/counter.jsx)です。

公式サイトとPlaygroundは同じ`apps/web`へ接続し、Playgroundだけ実行管理画面を追加します。
別のデモを起動するときも同じ入口へ引数を渡します。

```bash
bun run dev site
bun run dev playground
bun run dev demo list
```

生成コードを圧縮せずに確認する場合は、次を実行します。

```bash
bun run build:inspect
```

出力先は`apps/demos/dist/`です。`dist/index.html`にはbuild時の初期値が反映され、
`dist/app.js`にはDOM更新処理が含まれます。`irisout/ssr`は要求ごとのHTMLとhydrate stateを
生成します。`irisout/hono`と`irisoutRoutes`を使うと、`page.jsx`のファイル経路、loader、
リンク遷移を接続できます。

### デモ一覧

| コマンド                      | 確認できる機能                                   | ソース                                                  |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| `bun run dev demo list`       | キー付きリストの追加、更新、並べ替え、削除       | [`list.jsx`](./apps/demos/list.jsx)                     |
| `bun run dev demo notes`      | フォーム、タブ、局所状態、条件分岐、入れ子リスト | [`notes.jsx`](./apps/demos/notes.jsx)                   |
| `bun run dev demo heatmap`    | 本文入力、指標切り替え、段落一覧、全体地図       | [`heatmap.jsx`](./apps/demos/heatmap.jsx)               |
| `bun run dev demo todomvc`    | TodoMVCの操作                                    | [`todomvc.jsx`](./apps/demos/todomvc.jsx)               |
| `bun run dev demo multi-file` | 相対モジュールによるファイル分割                 | [`multi-file/App.jsx`](./apps/demos/multi-file/App.jsx) |

開発サーバーを切り替えるときは、実行中の処理を`Ctrl+C`で終了してください。

`bun run dev demo heatmap`は`@libraz/suzume`のブラウザ内日本語解析、WebAssembly、JSON辞書URL、CSS、
Worker入口を読み込みます。配信先に接頭辞がある場合は`IRISOUT_BASE=/heatmap/ bun run build`
で資源URLを確認できます。

## 処理の流れ

1. `compileProject(entryPath)`が入口の`.jsx`と相対読み込み先を解析します。
2. コンポーネントを展開し、JSX、状態、依存関係、更新先を確定します。
3. コンポーネントをビルド時に一度実行し、静的な初期HTMLを生成します。
4. 状態ごとのDOM更新関数と、使用した機能に必要な共有処理を生成します。
5. ブラウザは初期HTMLを引き継ぎ、イベントと更新処理を接続します。要求ごとのSSRは別契約です。

この処理では、仮想DOMやアプリケーション全体を対象にする実行時の依存グラフを
使用しません。設計原則は[`CONCEPT.v3.md`](./CONCEPT.v3.md)、コンパイラの処理は
[`docs/architecture.md`](./docs/architecture.md)に記録しています。

## 対応範囲

主な対応機能は次のとおりです。

- `signal`と`derived`
- 関数形式の`signal`更新とキー付きリスト
- テキストと属性の更新
- イベント処理
- キー付きリストと条件分岐
- 同一ファイルと相対モジュールのコンポーネント合成
- `use=`によるDOM操作と破棄処理
- `onMount`、`effect`、コンテキスト
- コンポーネントのマウント、初期HTMLの引き継ぎ、破棄
- `children` propによる同一ファイルcomponentの子JSX展開
- SVG要素、静的なSVG名前空間属性、SVGの動的属性更新

`compileProject()`では、直接のmodule共有`signal`と`derived`を受理します。
配列signalは複数のcomponent instanceで共有され、ListのDOM状態はinstanceごとに
保持されます。module共有stateのrequest単位SSR分離と永続化は対応範囲に含めません。

SVGは`svg`以下の要素を既存のJSXで記述できます。通常の動的属性は`setAttribute`で更新し、
`xlink:*`、`xml:*`、`xmlns:*`の名前空間属性は静的文字列に限ります(ADR-0042)。

ルートコンポーネントは1個、コンパイラが解析するモジュールは相対`.js`と`.jsx`です。
同一ファイルcomponentの`children` propは、component本体のJSX要素の直接の子位置へ
展開します。外部moduleとViteの資源importは生成moduleへ渡します。
コンパイラは未対応の構文を`compile: ... (scope limit)`
として拒否します。対応状況と制約は[`STATUS.md`](./STATUS.md)を参照してください。

`compile()`と`compileProject()`は生成JavaScriptとSource Map v3形式の`map`を返します。
イベント処理、`use=`の初期化・更新・破棄、`onMount`と`effect`の実行・片付けを、元の
`.js`または`.jsx`の処理文へ対応付けます。Vite連携は開発時と`build.sourcemap: true`の
本番ビルドへこの対応を引き継ぎます。共有実行時処理、DOM探索、一覧照合、条件分岐管理、
自動生成した更新関数には一対一の元構文がないため、元のJSXへ対応付けません。

注: Source Mapは、生成JavaScriptの行・列を変換前のファイルの行・列へ戻す情報である。

## 性能計測

現行コンパイラの生成物、手書き実装、Reactの製品用ビルドを同じChromiumで計測して
います。転送量、初期化、更新、DOM変更、JavaScriptヒープ、生成コードの結果と条件は
[`packages/bench/todomvc-compiler.results.md`](./packages/bench/todomvc-compiler.results.md)
にあります。手書き実装の値をirisoutの生成性能として扱っていません。

ヒートマップのWorker解析は`bun run bench:heatmap`で実Chromiumへ接続して測定できます。
段落数ごとの解析時間、表示までの時間、ページ側JavaScriptヒープ、キーボード操作の結果は
[`packages/bench/heatmap.results.md`](./packages/bench/heatmap.results.md)にあります。

## 開発

予定した試用版の機能と配布準備は完了しています。現在は機能を先に増やさず、再現可能な
不具合と実際の利用で確認した不足を変更の起点にします。判断の根拠は
[開発方針](./docs/project-direction.md)、着手条件は[ロードマップ](./ROADMAP.md)に記載しています。

```bash
bun install
bun run check
bun run test
bun run build
bun run build:packages
bun run pack:smoke
```

### ルートコマンド

以下はすべてリポジトリのルートで実行します。開発サーバーやプレビューを終了するときは
`Ctrl+C`を押してください。
開発入口は`dev`一つで、対象は引数で選びます。

#### 開発サーバー

| コマンド                  | 用途                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `bun run dev`             | `apps/demos`のCounterを起動する                                                      |
| `bun run dev site`        | `apps/web`の公式サイトと`/playground`ページを起動する                                |
| `bun run dev playground`  | 公式サイトと実行管理画面を別配信元で起動する                                         |
| `bun run dev demo <名前>` | `counter`、`list`、`notes`、`heatmap`、`todomvc`、`multi-file`のデモを選んで起動する |
| `bun run start`           | デモをbuildしてプレビューする                                                        |
| `bun run dev --help`      | 開発入口の使い方を表示する                                                           |

`bun run dev playground`は、公式サイトと`/playground`ページを`127.0.0.1:5173`、実行管理画面を
`localhost:5174`で起動します。これは同じマシンでもhostnameを分けてCookieと実行権限の境界を
保つためです。ポートを変える場合は、片方だけを変えず両方を指定してください。

```sh
IRISOUT_PLAYGROUND_SITE_PORT=45173 \
IRISOUT_PLAYGROUND_CONTROLLER_PORT=45174 \
bun run dev playground
```

#### 検査

| コマンド                      | 用途                                                     |
| ----------------------------- | -------------------------------------------------------- |
| `bun run check`               | 整形、静的検査、全workspaceの型検査を行う                |
| `bun run check:fix`           | 整形を修正してから全workspaceの型検査を行う              |
| `bun run lint`                | lintだけを行う                                           |
| `bun run typecheck`           | 整形とlintを省略して型検査を行う                         |
| `bun run typecheck:tsc`       | root、デモ、利用者側検証用アプリ、公式サイトを型検査する |
| `bun run typecheck:jsx`       | `apps/demos`のauthored JSXを型検査する                   |
| `bun run typecheck:consumer`  | `fixtures/consumer-app`を型検査する                      |
| `bun run typecheck:web`       | `apps/web`を型検査する                                   |
| `bun run test`                | コンパイラと実DOMの試験を実行する                        |
| `bun run site:test`           | 公式サイトの文書生成試験を実行する                       |
| `bun run test:web:playground` | Playgroundのブラウザー試験を実行する                     |
| `bun run test:web:server`     | Playgroundサーバーの接続試験を実行する                   |
| `bun run test:web:save`       | Playground保存処理の試験を実行する                       |

#### buildと梱包

| コマンド                 | 用途                                                 |
| ------------------------ | ---------------------------------------------------- |
| `bun run build`          | `apps/demos`を`dist/`へbuildする                     |
| `bun run build:inspect`  | 圧縮しないデモの生成物を`apps/demos/dist/`へ作る     |
| `bun run site:build`     | 公式サイトの文書だけを生成する                       |
| `bun run site:check`     | 文書と公式例の生成結果を検査する                     |
| `bun run build:web`      | 文書、公式サイト、Playgroundの本番生成物を作る       |
| `bun run build:packages` | 公開パッケージのJavaScriptと型定義を生成する         |
| `bun run pack:smoke`     | ローカル梱包物を別アプリへ導入して検査する           |
| `bun run registry:smoke` | npm公開版`irisout@0.2.2`を別アプリへ導入して検査する |

#### ベンチマーク

| コマンド                          | 用途                               |
| --------------------------------- | ---------------------------------- |
| `bun run bench`                   | TodoMVCの生成版とReact版を比較する |
| `bun run bench:browser`           | TodoMVCのブラウザー比較を実行する  |
| `bun run bench:todomvc-compiler`  | TodoMVCのコンパイラ出力を比較する  |
| `bun run bench:heatmap`           | ヒートマップのWorker解析を測定する |
| `bun run bench:list-runtime`      | Listの実行時処理を測定する         |
| `bun run bench:listener-strategy` | イベントlistener方式を測定する     |

`check`は整形、静的検査、TypeScriptとauthored JSXの型検査を実行します。デモと別アプリの
型検査も含みます。`test`はVite+ Testによる試験を実行します。規約は
[`docs/conventions.md`](./docs/conventions.md)を参照してください。

別のViteアプリから使う場合は、設定へ連携を追加して入口とhydrate対象を指定します。
workspaceでの導入検証は[`fixtures/consumer-app/`](./fixtures/consumer-app/)です。

```ts
import { irisout } from 'irisout/vite'

export default {
  plugins: [irisout({ entry: 'src/App.jsx', container: '#app' })],
}
```

入口と相対`.js`/`.jsx`の編集時は、開発サーバーを再起動せずに初期HTMLと生成JavaScriptを
再生成し、ページ全体を再読み込みします。

開発中はworkspaceで導入します。配布入口のJavaScriptと型定義は`bun run build:packages`で
生成し、`bun run pack:smoke`で一時ディレクトリへ梱包物を導入してVite buildを確認できます。
公開単位は一つの`irisout`パッケージです。`bun run registry:smoke`はnpmで公開した
`irisout@0.2.2`を別ディレクトリへ導入し、型検査とVite buildを確認します。
作者以外による手動試用は未実施です。
梱包方針は[ADR-0047](./docs/adr/0047-single-public-package.md)に記載しています。

## AI向けSkill

`skills/irisout-development`に、AIがirisoutアプリを作成、診断、検証するためのSkillを
置いています。公開入口、記述範囲、Vite+アプリの雛形を含みます。GitHub上のこの
リポジトリから次のコマンドで導入できます。

```sh
npx skills add mikan-919/irisout --skill irisout-development
```

注: `skills`はリポジトリ内の`skills/<名前>/SKILL.md`を検出し、対応するAI実行環境へ
Skillを導入するコマンドです。利用可能なSkillだけを確認する場合は
`npx skills add mikan-919/irisout --list`を使います。

## 資料

| ファイル                                                   | 内容                         |
| ---------------------------------------------------------- | ---------------------------- |
| [`CONCEPT.v3.md`](./CONCEPT.v3.md)                         | 目的と設計原則               |
| [`docs/project-direction.md`](./docs/project-direction.md) | 今後の開発方針と判断の根拠   |
| [`docs/getting-started.md`](./docs/getting-started.md)     | npm公開版による新規導入手順  |
| [`STATUS.md`](./STATUS.md)                                 | 対応状況と制約               |
| [`ROADMAP.md`](./ROADMAP.md)                               | 今後の作業と着手条件         |
| [`docs/architecture.md`](./docs/architecture.md)           | コンパイラの構成と処理       |
| [`docs/adr/`](./docs/adr/)                                 | 設計判断と却下案             |
| [`openspec/specs/`](./openspec/specs/)                     | 実装対象の受け入れ条件と仕様 |

## ライセンス

Apache License 2.0です。[`LICENSE`](./LICENSE)を参照してください。
