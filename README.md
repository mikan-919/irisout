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
> 現時点の配布形式はGitリポジトリのworkspaceと、検証用のpackage tarballです。npm等へは公開していません。
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

必要なものは[Git](https://git-scm.com/)と
[Bun 1.3.13](https://bun.sh/docs/installation)です。Vite+の全体インストールは不要です。

```bash
git clone https://github.com/mikan-919/irisout.git
cd irisout
bun install
bun run dev
```

端末に表示されたURLをブラウザで開き、`increment`を押してください。ソースは
[`apps/examples/counter.jsx`](./apps/examples/counter.jsx)です。

生成コードを圧縮せずに確認する場合は、次を実行します。

```bash
bun run build:inspect
```

出力先は`apps/examples/dist/`です。`dist/index.html`にはbuild時の初期値が反映され、
`dist/app.js`にはDOM更新処理が含まれます。現行の公開入口はclient build用で、要求ごとの
SSR HTML生成は対応していません。

### 別の例

| コマンド                 | 確認できる機能                                   | ソース                                                     |
| ------------------------ | ------------------------------------------------ | ---------------------------------------------------------- |
| `bun run dev:list`       | キー付きリストの追加、更新、並べ替え、削除       | [`list.jsx`](./apps/examples/list.jsx)                     |
| `bun run dev:notes`      | フォーム、タブ、局所状態、条件分岐、入れ子リスト | [`notes.jsx`](./apps/examples/notes.jsx)                   |
| `bun run dev:heatmap`    | 本文入力、指標切り替え、段落一覧、全体地図       | [`heatmap.jsx`](./apps/examples/heatmap.jsx)               |
| `bun run dev:todomvc`    | TodoMVCの操作                                    | [`todomvc.jsx`](./apps/examples/todomvc.jsx)               |
| `bun run dev:multi-file` | 相対モジュールによるファイル分割                 | [`multi-file/App.jsx`](./apps/examples/multi-file/App.jsx) |

開発サーバーを切り替えるときは、実行中の処理を`Ctrl+C`で終了してください。

`dev:heatmap`は`@libraz/suzume`のブラウザ内日本語解析、WebAssembly、JSON辞書URL、CSS、
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
- `collection`によるキー付きリスト
- テキストと属性の更新
- イベント処理
- キー付きリストと条件分岐
- 同一ファイルと相対モジュールのコンポーネント合成
- `use=`によるDOM操作と破棄処理
- `onMount`、`effect`、コンテキスト
- コンポーネントのマウント、初期HTMLの引き継ぎ、破棄
- `children` propによる同一ファイルcomponentの子JSX展開
- SVG要素、静的なSVG名前空間属性、SVGの動的属性更新

`compileProject()`では、直接のmodule共有`signal`、`derived`、`collection`を受理します。
共有collectionの配列は複数のcomponent instanceで共有され、ListのDOM状態はinstanceごとに
保持されます。module共有stateのrequest単位SSR分離と永続化は対応範囲に含めません。

SVGは`svg`以下の要素を既存のJSXで記述できます。通常の動的属性は`setAttribute`で更新し、
`xlink:*`、`xml:*`、`xmlns:*`の名前空間属性は静的文字列に限ります(ADR-0042)。

ルートコンポーネントは1個、コンパイラが解析するモジュールは相対`.js`と`.jsx`です。
同一ファイルcomponentの`children` propは、component本体のJSX要素の直接の子位置へ
展開します。外部moduleとViteの資源importは生成moduleへ渡します。
コンパイラは未対応の構文を`compile: ... (scope limit)`
として拒否します。対応状況と制約は[`STATUS.md`](./STATUS.md)を参照してください。

## 性能計測

現行コンパイラの生成物、手書き実装、Reactの製品用ビルドを同じChromiumで計測して
います。転送量、初期化、更新、DOM変更、JavaScriptヒープ、生成コードの結果と条件は
[`packages/bench/todomvc-compiler.results.md`](./packages/bench/todomvc-compiler.results.md)
にあります。手書き実装の値をirisoutの生成性能として扱っていません。

ヒートマップのWorker解析は`bun run bench:heatmap`で実Chromiumへ接続して測定できます。
段落数ごとの解析時間、表示までの時間、ページ側JavaScriptヒープ、キーボード操作の結果は
[`packages/bench/heatmap.results.md`](./packages/bench/heatmap.results.md)にあります。

## 開発

今後は、情報量ヒートマップで記述と動作を検証し、作者以外が別のリポジトリへ導入できる試用版を目指します。診断と対応範囲の整備、部品分割と非同期更新の検証、初期化処理の改善、外部導入の順に進めます。判断の根拠は[開発方針](./docs/project-direction.md)、各段階の完了条件は[ロードマップ](./ROADMAP.md)に記載しています。

```bash
bun install
bun run check
bun run test
bun run build
bun run build:packages
bun run pack:smoke
```

`check`は整形、静的検査、TypeScriptとauthored JSXの型検査を実行します。examplesと別アプリの
型検査も含みます。`test`はVite+ Testによる試験を実行します。規約は
[`docs/conventions.md`](./docs/conventions.md)を参照してください。

別のViteアプリから使う場合は、設定へ連携を追加して入口とhydrate対象を指定します。
workspaceでの導入例は[`examples/consumer-app/`](./examples/consumer-app/)です。

```ts
import { irisout } from '@irisout/vite-plugin'

export default {
  plugins: [irisout({ entry: 'src/App.jsx', container: '#app' })],
}
```

入口と相対`.js`/`.jsx`の編集時は、開発サーバーを再起動せずに初期HTMLと生成JavaScriptを
再生成し、ページ全体を再読み込みします。

開発中はworkspaceで導入します。配布入口のJavaScriptと型定義は`bun run build:packages`で
生成し、`bun run pack:smoke`で一時ディレクトリへ梱包物を導入してVite buildを確認できます。
packageは`0.1.0`として梱包できますが、npm等への登録と作者以外による手動試用は未実施です。
梱包方針は[ADR-0043](./docs/adr/0043-package-bundles-and-pack-smoke.md)に記載しています。

## 資料

| ファイル                                                   | 内容                         |
| ---------------------------------------------------------- | ---------------------------- |
| [`CONCEPT.v3.md`](./CONCEPT.v3.md)                         | 目的と設計原則               |
| [`docs/project-direction.md`](./docs/project-direction.md) | 今後の開発方針と判断の根拠   |
| [`STATUS.md`](./STATUS.md)                                 | 対応状況と制約               |
| [`ROADMAP.md`](./ROADMAP.md)                               | 開発順序と各段階の完了条件   |
| [`docs/architecture.md`](./docs/architecture.md)           | コンパイラの構成と処理       |
| [`docs/adr/`](./docs/adr/)                                 | 設計判断と却下案             |
| [`openspec/specs/`](./openspec/specs/)                     | 実装対象の受け入れ条件と仕様 |

## ライセンス

Apache License 2.0です。[`LICENSE`](./LICENSE)を参照してください。
