# 変更履歴

## 0.3.5 - 2026-09-26

- HonoのSSR専用文書で`irisout-client.js`を読み込まない場合、ページ変更時に文書を再読み込みして編集内容を反映する。

## 0.3.4 - 2026-09-26

- 開発時のpage moduleをViteの仮想moduleとして解決し、Hono構成でページ編集がHMRへ届かない問題を修正する。

## 0.3.3 - 2026-09-26

- `irisout/hono/vite`の開発時にViteのHMR clientをHTMLへ挿入し、編集中のページmoduleを差し替える。
- 現在のページだけをSSR結果から再hydrateする。ページ内signal状態は初期値へ戻る。経路の追加・削除は開発サーバーを再起動する。

## 0.3.1 - 2026-09-26

- `irisout/hono/vite`でページ変更後もSSRに古い内容が残る問題を修正し、該当ページを再コンパイルしてからブラウザーを再読込する。
- Honoの`document`使用例に`irisout-client.js`の読み込みを追加する。

## 0.3.0 - 2026-09-26

- 利用者が記述するJSXでは、記述APIを`irisout`から名前付きimportする形式に変更した。`irisout/jsx`の大域宣言を削除し、記述APIのimportは生成物から取り除く。
- ブラウザ内コンパイラ`irisout/browser`、要求ごとのサーバー描画入口`irisout/ssr`、ファイル経路とHono連携の`irisout/routes`・`irisout/hono`・`irisout/hono/vite`を追加した。
- 任意のMotion連携`irisout/motion`・`irisout/motion/vite`に、条件分岐とキー付き一覧から要素を外すときの`AnimatePresence`と`exit`を追加した。退場モードは`sync`に限る。

### 移行

`signal`、`derived`、`render`などを使うauthored JSXへ、
`import { signal, derived, render } from 'irisout'`のような名前付きimportを追加する。
`irisout`と`irisout/browser`の`compile(source)`へ渡す単一ソース内の裸の記述API呼び出しは引き続き受理する。

## 0.2.2 - 2026-09-12

- 導入手順、実装状況、開発計画の記述を現状に合わせた。
- irisoutを使うアプリ開発用スキルの対象と手順を整理した。

公開入口、記法、生成コードの変更はない。

## 0.2.1 - 2026-09-11

- `signal((previous) => next)`による関数形式の更新を追加した。
- `signal(initial, keyOf)`と`.update(key, updater)`を削除した。
- 配列signalの一覧更新をJSXの`key`による全体再調整へ統一した。
- Webアプリの依存を単一の`irisout`パッケージへ統一した。

### 移行

`collection(initial, keyOf)`または`signal(initial, keyOf)`を`signal(initial)`へ置き換える。項目更新は`items((previous) => previous.map(...))`、削除は`items((previous) => previous.filter(...))`と記述する。

## 0.1.1 - 2026-09-10

- イベント処理、`use=`、`onMount`、`effect`の作者記述を元のJSXへ対応付ける実行時ソースマップを追加した。
- 別ファイルの部品で未対応構文を拒否したとき、原因となるファイル、行、列を示すよう診断を修正した。
- npm公開版から始める手順、JSX型検査の設定、初期HTMLと破棄の範囲を利用文書へ追加した。

公開入口の削除と既存記法の変更はない。共有実行時処理、DOM探索、一覧照合、条件分岐管理、自動生成した更新関数は、対応する元構文が一つに定まらないためソースマップの対象外である。

## 0.1.0 - 2026-09-09

- コンパイラ、実行時処理、Vite連携、診断、JSX型定義を単一の`irisout`パッケージとして初めて公開した。
