# ADR-0018: 生成モジュールにcomponent instance境界を置く

## ステータス

**決定済み・実装済み**(2026-09-04)。

## コンテキスト

従来の生成モジュールはsignal値、derived値、`__markers__`、handler、List runtime、
conditional状態、`use=`の返り値をモジュール直下に1組だけ置いていた。同じ生成モジュールの
`mountComponent()`または`hydrateComponent()`を2回呼ぶと、後の呼び出しが
`__markers__`を上書きし、先にmountした要素のイベントが後のDOMを更新していた。

同一ファイル内合成にも別の共有問題があった。`<Counter /><Counter />`のようにstateを持つ
同じ子コンポーネントをroot内で複数回使うと、複製ASTのdeclarator位置が同じためDeclIdが
衝突し、2箇所が同じsignalと`update_*`を共有していた。

## 決定

生成コードに`createComponent()`を出力し、次をその関数のクロージャへ置く。

- signal / derivedの値
- marker Map
- handlerと追跡された動きゾーン関数
- List runtime、conditional state、template
- `use=`の返り値
- `update_*`関数

`createComponent()`は`mount`、`hydrate`、そのインスタンス専用の`update_*`を返す。
既存の`mountComponent(container)`と`hydrateComponent(container)`は毎回
`createComponent()`を呼び、初期化済みインスタンスを返す。モジュール直下の`update_*` exportは
廃止する。これはauthoring APIではなく内部検証用だったため、曖昧な「最後にmountした
インスタンス」への転送は作らない。

インライン化された宣言の識別には、従来の`instanceId + declaratorStart`にhygienic rename後の
binding名を加える。同じソース位置から複製された子コンポーネント呼び出しでも、各宣言、依存、
handler更新先を分離する。

## 結果

- 同じ生成モジュールを複数containerへmount/hydrateでき、状態とDOM更新が混ざらない。
- stateを持つ同じ子コンポーネントをroot内で複数回使っても、それぞれ独立する。
- List runtimeとconditional stateもroot instanceごとに作られる。
- 将来のdispose/cleanupはcomponent instanceが所有する処理として追加できる。
- counter production bundleは手書き比4.38xとなり、意図したfactory固定費としてサイズ予算を
  4xから4.5xへ更新した。
- 1つの`createComponent()`を複数回mountする使い方は保証しない。1 instanceは1 rootを所有する。

## 対象外

- unmount、event listener解除、`use=` cleanup
- conditional branch内の変数ゾーン付きコンポーネント
- 複数ファイルからのコンポーネントimport
- children / slot、自己・相互再帰
