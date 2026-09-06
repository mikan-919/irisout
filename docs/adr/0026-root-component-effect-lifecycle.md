# ADR-0026: ルートcomponentの`effect` lifecycle

## ステータス

**決定済み・実装済み**(2026-09-06)。ルートinstanceと構造unit factoryへ依存信号による
副作用の再実行とcleanupを接続する。汎用schedulerは対象外とする。

## コンテキスト

`onMount`だけでは、root signalの変化に応じてDOM外の購読や文書状態を同期できない。
既存の生成器はsignalごとの専用`update_*()`を持つため、effectの依存をその関数へ直接
配線すれば、共有runtimeや暗黙のschedulerを追加せず再実行を実現できる。

## 決定

### authored API

ルートcomponentの動きゾーン、またはlist/conditionalのunit本体で次の形を受理する。

```jsx
effect(() => {
  document.title = String(count())
  return () => stopExternalWork()
})
```

- `effect`は0引数のinline arrow callbackを1個受け取る。
- callback本体は既存のaction/handler文解析を使い、直接読み取ったroot signal/derivedを
  依存として記録する。
- callbackが0引数のarrow/functionを返す場合、それをcleanupとする。object result、引数付き
  cleanup、動的なcleanup値はscope limitで拒否する。
- 追跡対象signal/derivedへの書き込みはscope limitで拒否する。これは更新中の再入を暗黙に
  発生させないためである。DOM・外部オブジェクトへの書き込みは許可する。

### instance lifecycle

- 初回実行はmarker収集、handler配線、構造unit初期populate、action初期化、`onMount`の
  後に行う。mountとhydrateで同じ順序にする。
- 初期化中に`onMount`が依存signalを書き換えても、effectの初回実行前の再実行は抑止し、
  現在値に対して初回だけ実行する。
- 依存signalの専用`update_*()`がmarkerを更新した後、該当effectを登録順に再実行する。
- 構造unitでは、unit local signalの所有factory update、item値の変更、root signalから
  合流したmarker updateが該当effectを再実行する。
- 再実行前に前回cleanupを一度実行し、返り値がない場合は保持値を空にする。
- unmountでは`onMount` cleanupを先に、effect cleanupをその登録順の逆順に実行し、例外が
  あっても残りのcleanupとDOM解放を続けて最初の例外を再送出する。
- 既存のunmount idempotencyと、unmount後の`update_*()` no-opを維持する。

### compiler boundary

- effectを使わない生成物へeffect専用変数・依存配線・runtime importを出力しない。
- effectは生成instance内の専用関数として出力し、汎用runtime scheduler/registryは追加しない。
- 構造unit内のeffectはunit factoryが所有する。inline子componentのcallbackはroot、list
  item、conditional branchのinline先へ収集する。runtime child objectは生成しない。

## 検討した代替案

- 汎用runtime schedulerへ登録する案: 更新粒度と所有者が不明確になり、effect未使用時の
  固定費も増えるため却下した。
- effectからsignal書き込みを許可する案: 同期`update_*()`から再入するため、キュー・循環
  検出・実行順の追加契約が必要になる。最小契約では明示的に拒否する。
- effectを`onMount`の返り値へ統合する案: 再実行依存と初回起動の意味が異なるため却下した。
