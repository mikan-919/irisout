# ADR-0018: 生成モジュールにcomponent instance境界を置く

## ステータス

**決定済み・実装済み**(2026-09-04、unmount 拡張は 2026-09-05 に ADR-0022)。

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
- `use=`の update/destroy state
- `update_*`関数

`createComponent()`は`mount`、`hydrate`、`unmount`、そのインスタンス専用の`update_*`を返す。
既存の`mountComponent(container)`と`hydrateComponent(container)`は毎回
`createComponent()`を呼び、初期化済みインスタンスを返す。モジュール直下の`update_*` exportは
廃止する。これはauthoring APIではなく内部検証用だったため、曖昧な「最後にmountした
インスタンス」への転送は作らない。

instanceは一度だけmountまたはhydrateできる。`unmount()`はidempotentで、top-level
handlerをremoveし、actionの`destroy`を登録順の逆順で一度ずつ呼び、marker/List/
conditional/template stateとcomponent-owned DOMを解放する。unmount後に保持された
`update_*`はno-opとする。再利用ではなく、新しいinstanceを生成する。

インライン化された宣言の識別には、従来の`instanceId + declaratorStart`にhygienic rename後の
binding名を加える。同じソース位置から複製された子コンポーネント呼び出しでも、各宣言、依存、
handler更新先を分離する。

Listの通常経路では、itemごとに`update`クロージャを作らない。factoryはDOM参照、現在値、
binding状態だけを持つhandle objectを返し、factoryと同じスコープに1個だけ生成した
`update(handle, next)`を全itemで共有する。runtimeの`reconcileList()`は既存keyの更新時に
この共有関数へhandleを渡す。ネストした構造ユニットまたはローカルsignalを持つitemは、外側の
lexical scopeを保持する必要があるため、現時点では従来のhandle更新経路を使う。

## 結果

- 同じ生成モジュールを複数containerへmount/hydrateでき、状態とDOM更新が混ざらない。
- stateを持つ同じ子コンポーネントをroot内で複数回使っても、それぞれ独立する。
- List runtimeとconditional stateもroot instanceごとに作られる。
- component-owned DOMとtop-level listenerを明示的に解放でき、`use=`の外部 resourceは
  ADR-0022の`{ destroy }`で確実に解除できる。
- counter production bundleはexplicit lifecycle固定費を含む手書き比5.33xとなり、サイズ予算を
  4.5xから5.5xへ更新した。
- 1つの`createComponent()`を複数回mountする使い方は保証しない。1 instanceは1 rootを所有する。

## 対象外

- conditional branch内の変数ゾーン付きコンポーネント
- 複数ファイルからのコンポーネントimport
- children / slot、自己・相互再帰
