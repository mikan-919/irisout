# irisout

![irisout](./docs/assets/logo.png)

JSXから静的HTMLと、状態に応じてDOMを更新するJavaScriptを生成するコンパイラです。初期HTMLはビルド時に作り、ブラウザーでは必要な更新処理だけを動かします。

```text
JSX → ビルド → 静的HTML + DOM更新コード
```

## irisoutを使う

npm公開版を使った新規アプリの作成は、[導入手順](./docs/getting-started.md)を参照してください。APIや記述方法は[利用者向け文書一覧](./docs/README.md#irisoutを使う)にまとめています。

動作を試すには、リポジトリを取得してデモを起動します。

```sh
git clone https://github.com/mikan-919/irisout.git
cd irisout
bun install
bun run dev
```

表示されたURLをブラウザーで開くとCounterを試せます。ほかのデモは次のように起動します。

```sh
bun run dev demo list
bun run dev demo notes
bun run dev demo heatmap
bun run dev demo todomvc
bun run dev demo multi-file
```

## 動作の概要

```jsx
import { render, signal } from 'irisout'

export function Counter() {
  const count = signal(0)

  render(
    <button type="button" onClick={() => count(count() + 1)}>
      {count()}
    </button>,
  )
}
```

コンパイラは初期HTMLを生成し、`count`を読む箇所だけを書き換えるコードを出力します。`signal`と`render`はコンパイル時に使う記述APIです。仮想DOMは使わず、状態の変更を対応するDOMへ反映します。リストや条件分岐など、実行時の処理が必要な機能では共有コードを使います。

irisoutはReact互換の実行環境ではありません。対応する記法と制約は[診断と対応範囲](./docs/diagnostics-and-limits.md)を確認してください。

## 主な機能

- `signal`と`derived`による状態管理
- テキスト、属性、イベントの更新
- キー付きリストと条件分岐
- 同じファイルや相対モジュールに分けた部品
- `onMount`、`effect`、コンテキスト
- `use=`による要素単位の処理と破棄
- 要求単位のSSRとHonoのファイル経路
- SVGとMotion拡張

詳しくは[APIリファレンス](./docs/api-reference.md)を参照してください。

## irisout本体を開発する

依存関係を導入し、静的検査、型検査、試験、ビルドを実行します。

```sh
bun install
bun run check
bun run test
bun run build
```

パッケージの生成と、梱包物を別アプリへ導入する検査には次を使います。

```sh
bun run build:packages
bun run pack:smoke
```

コマンドの一覧は[package.json](./package.json)、開発時に読む文書は[開発者向け文書一覧](./docs/README.md#irisout本体を開発する)を参照してください。

## 設計と仕様

プロジェクトの目的は[CONCEPT.v3.md](./CONCEPT.v3.md)、現在の対応状況は[STATUS.md](./STATUS.md)、今後の作業は[ROADMAP.md](./ROADMAP.md)に記載しています。決定した設計は[ADR](./docs/adr/)、実装する機能の受け入れ条件は[OpenSpec](./openspec/specs/)を参照してください。

ベンチマークの結果と測定コードは[`packages/bench/`](./packages/bench/)にあります。

## ライセンス

irisoutは[MIT License](./LICENSE)のもとで公開しています。
