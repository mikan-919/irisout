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
- object の `update` は上記関数形式と同じタイミング、`destroy` は unmount 時だけ呼ぶ。
- 複数 action の `destroy` は登録順の逆順で、各 action 一回だけ呼ぶ。destroy が一つ
  throw しても残りの destroy と instance cleanup は継続し、最後に最初の error を再送出
  する。
- 返り値は生成 code の runtime 境界でも検証し、`null`、非関数の `update`/`destroy`、
  未知の object property は mount 時に Error とする。コンパイラが静的に明らかな不正形を
  見つけた場合は `scope limit` で拒否する。
- action 内部が登録した外部 resource の解除は `destroy` の責務である。runtime は
  action の内部 resource を推測して解除しない。

### 解放範囲

unmount は次の順序で instance 所有物を解放する。

1. compiler が生成した top-level handler を同じ function identity で
   `removeEventListener` する。
2. action の `destroy` を逆順に呼ぶ。
3. top-level List の keyed Map、conditional handle、template/document 参照、marker Map
   を解放する。
4. mount/hydrate した container の component-owned children を remove する。
5. container 参照と action update/destroy 参照を捨てる。

List item/conditional factory 内の listener は、その factory handle と DOM subtree を
top-level runtime から切り離すことで到達不能にする。factory 内で外部 resource を登録
する機能は現時点の scope limit の外であり、将来受理する場合も同じ `destroy` 契約を
追加で明示する必要がある。

## 対象外・意図的な制約

- unit 内 (`.map()` item / conditional branch) の `use=` は引き続き scope limit。動的な
  action registry、unit lifecycle、汎用 `onMount`/effect runtime は追加しない。
- component instance の再 mount/reuse、暗黙の DOM observer、custom element lifecycle は
  追加しない。
- `destroy` を signal 更新へ自動接続したり、action の引数を reactive に再評価したり
  しない。必要なら別の実需と代表 fixture で判断する。

## 結果

- mount/hydrate の所有 DOM と生成 listener を明示的に破棄でき、instance を保持しても
  detached DOM や structural runtime を保持し続けない。
- timer/subscription/external listener は object 形式の `destroy` で作者が正確に解除できる。
- counter の generated bundle は explicit lifecycle 固定費を含め手書き基準の実測 5.33x
  となり、snapshot のサイズ予算を 5.5x に更新した。
