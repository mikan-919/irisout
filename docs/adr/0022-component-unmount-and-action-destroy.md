# ADR-0022: component unmount と `use=` action destroy

## ステータス

**決定済み・実装済み**(2026-09-05)。ADR-0018 の component instance 境界へ、
明示的な `unmount()` と `use=` action の外部 resource cleanup を追加した。

## コンテキスト

`mountComponent()` / `hydrateComponent()` は component instance を返すが、これまで
instance が所有する DOM・top-level event listener・List/conditional runtime を明示的に
解放する API がなく、`use=` action の timer、subscription、document listener 等を作者が
確実に解除する契約もなかった。DOM だけを remove しても、action が外部 resource を保持
すれば instance または外部 emitter が component を到達可能にし続ける。

一方、既存の `use=` の関数返り値はリアクティブな update closure であり、cleanup として
解釈し直すと既存 authored code の意味が変わる。ADR-0004 の「意味的要求を超えない」
原則に従い、既存形式を維持したまま cleanup を明示できる最小の拡張が必要だった。

## 決定

### 公開 API と instance lifecycle

- `createComponent()`、`mountComponent(container)`、`hydrateComponent(container)` が返す
  instance は `unmount(): void` を持つ。
- 一つの instance は `mount()` または `hydrate()` を一度だけ実行できる。active 中の
  二回目、または unmount 後の再 mount/hydrate は明示的な Error とする。新しい root が
  必要なら `createComponent()` または top-level entry point をもう一度呼ぶ。
- `unmount()` は active でない場合を no-op とし、二回呼んでも副作用を起こさない。
- unmount 後に保持された `update_*()` は no-op になる。これは detached DOM を更新したり、
  破棄済み List/conditional state を再生成したりしないためである。

### action の返り値

`use={action}` は次の返り値を受け付ける。

```ts
void
(() => void)
{ update?: () => void; destroy?: () => void }
```

- 既存の関数形式は **update** として、mount/hydrate 直後に一度、依存 signal が更新
  されるたびに一度呼ぶ。関数に `destroy` のようなプロパティがあっても、既存意味を
  壊さないため object 形式へ変換しない。
- object の `update` は上記関数形式と同じタイミング、top-level action の `destroy` は
  component unmount 時、構造unit内actionの`destroy`は所有unitの破棄時だけ呼ぶ。
- 複数 action の `destroy` は登録順の逆順で、各 action 一回だけ呼ぶ。destroy が一つ
  throw しても残りの destroy と instance cleanup は継続し、最後に最初の error を再送出
  する。
- 返り値は生成 code の runtime 境界でも検証し、`null`、非関数の `update`/`destroy`、
  未知の object property は mount 時に Error とする。コンパイラが静的に明らかな不正形を
  見つけた場合は `scope limit` で拒否する。
- action 内部が登録した外部 resource の解除は `destroy` の責務である。runtime は
  action の内部 resource を推測して解除しない。

### 構造unitのaction lifecycle

`.map()` item・conditional branchの`use=`は、対応するfactory handleが保持する。
handleは`el`、item/branch更新用の`update`、DOM接続後の`mount`、冪等な`destroy`を持つ。

- Listの既存keyは同じhandleを再利用する。keyed reorderではsetup・mount・destroyを
  追加で実行しない。
- 新規itemはDOM順序を確定してから`mount()`する。branch切替は旧handleのdestroy、
  旧DOMのremove、新handleの生成・挿入・mountの順で行う。
- factoryのmountは子List/conditionalを先にmountし、その後自身のactionをsource orderで
  初期化する。factoryのdestroyは破棄済みフラグを先に立て、local handler、子unit、
  自身のactionの逆順で解放する。子unitのdestroyは一度だけ実行する。
- root unmountはtop-level handlerのremove、top-level構造unitのdestroy、top-level
  actionの逆順destroy、marker・template・containerの解放の順で行う。

この明示的な順序により、子の外部listenerが親actionより先に解除される。destroyが
例外を投げても同じ所有者の残りのaction・子unit・DOM処理を続け、最初の例外を再送出する。

### 解放範囲

unmount は次の順序で instance 所有物を解放する。

1. compiler が生成した top-level handler を同じ function identity で
   `removeEventListener` する。
2. top-level List item・conditional branchのhandleを子unitから順にdestroyし、DOMを
   removeする。
3. top-level action の `destroy` を登録順の逆順で呼ぶ。
4. top-level Listのkeyed Map、conditional handle、template/document参照、marker Mapを
   解放する。
5. mount/hydrateしたcontainerのcomponent-owned childrenをremoveする。
6. container参照とaction update/destroy参照を捨てる。

List item/conditional factory内のlistenerは、factory handleのdestroyで同じfunction
identityを使ってremoveする。factory内actionが外部resourceを登録する場合は、top-level
actionと同じobject形式の`destroy`で解除する。actionを含まないfactoryは従来どおり
DOM subtreeのremoveと参照解放だけを行う。

## 対象外・意図的な制約

- unit内(`.map()` item / conditional branch)の`use=`はfactory handleへ接続する。
  動的な汎用action registry、汎用`onMount`/effect runtimeは追加しない。
- component instance の再 mount/reuse、暗黙の DOM observer、custom element lifecycle は
  追加しない。
- `destroy` を signal 更新へ自動接続したり、action の引数を reactive に再評価したり
  しない。必要なら別の実需と代表 fixture で判断する。

## 結果

- mount/hydrate の所有 DOM と生成 listener を明示的に破棄でき、instance を保持しても
  detached DOM や structural runtime を保持し続けない。
- timer/subscription/external listener はtop-levelまたはunit actionのobject形式
  `destroy`で作者が正確に解除できる。
- counter の generated bundle は explicit lifecycle 固定費を含め手書き基準の実測 5.33x
  となり、snapshot のサイズ予算を 5.5x に更新した。
