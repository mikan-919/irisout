# 変更履歴

## 0.2.1 - 未公開

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
