# ADR-0025: ルートcomponentの`onMount` lifecycle

## ステータス

**決定済み・実装済み**(2026-09-06)。ADR-0022で保留していた、要素に紐付かない
起動処理をルートcomponentの`onMount`として追加した。

## コンテキスト

`use=` actionは要素を受け取るため、timer・購読・WebSocketのようなcomponent全体の
処理を記述する場所にはならない。一方、既存の生成instanceは`mount()`/
`hydrate()`完了後と`unmount()`の所有権を持つため、そこへ小さいcallback列を接続
すれば追加の汎用schedulerやruntime registryなしで処理できる。

## 決定

### authored API

ルートcomponentの動きゾーンで、次の形を受理する。

```jsx
onMount(() => {
  startSubscription()
  return () => stopSubscription()
})
```

- `onMount`は0引数のinline arrow callbackを1個受け取る。
- callback本体は既存のaction/handler文解析の範囲を使う。
- callbackの最後に0引数のarrow/functionを返す場合、それをcleanupとする。
  object result、引数付きcleanup、動的なcleanup値はscope limitで拒否する。
- concise callbackの関数以外の式は起動処理として実行し、返り値は捨てる。
  したがって`onMount(() => connect())`はvoid callbackとして扱う。

`@irisout/compiler/jsx`にも`onMount(() => void | (() => void))`を宣言する。

### instance lifecycle

- callbackはinstanceごとにmountまたはhydrate完了後、一度だけ登録順で実行する。
  DOM markerの収集、handler配線、構造unitの初期populate、`use=` action初期化の後に
  実行する。
- cleanupはそのcallbackが関数を返した場合だけ保持し、unmount時に登録順の逆順で
  一度だけ実行する。
- cleanupが例外を投げても残りのcleanup、action、構造unit、DOM解放を続け、最初の
  例外を再送出する。callback初期化が失敗した場合は、その時点までに登録済みの
  cleanupを`unmount()`経路で実行する。
- 既存の`unmount()`のidempotency、同instanceの再mount拒否、unmount後updateのno-op
  は維持する。

### compiler boundary

- onMountを使わない生成物にはcleanup変数・callback配線・専用runtime importを出力
  しない。
- 構造unit内のonMountは、そのunitのfactory instanceが所有する。list itemのblock文と、
  inline化された子componentのcallbackをunitのmount時に登録し、item削除・branch切替・
  root unmountでcleanupを呼ぶ。
- inline化された子componentがroot scopeにある場合は、子のcallbackをroot instanceへ
  静的に移動する。これは既存のcompile-time inline境界をそのまま使う明示的な変換であり、
  runtime child objectや暗黙のregistryを生成しない。
- 構造unitのJSX式へ現れるinline childのcallbackも同じunit factoryへ収集する。effectの
  同じ所有境界への接続はADR-0026で定める。
- `effect`、context、SSR、再mount、汎用lifecycle registryはこのADRの対象外である。

## 検討した代替案

- `use=` actionへ統合する案: 要素を持たない処理の所有者が不明確になり、actionの
  要素契約を拡張するため却下した。
- runtimeの汎用hook registryを追加する案: root instanceの既存cleanup列で十分で、
  未使用生成物の固定費を増やすため却下した。
- 子componentのhookをruntime childへ保持する案: compile-time inline化でcomponent instance
  境界が消えるため、不要なruntime objectとregistryを追加する。root scopeはrootへ静的に
  移動し、構造unit内はfactoryへ収集する最小変換を採用した。
