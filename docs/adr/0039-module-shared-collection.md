# ADR-0039: module共有collectionの静的境界

## ステータス

**決定済み・実装対象**(2026-09-06)。`compileProject`のリンク済みmoduleに限り、直接の
module共有collectionを受理する。

## コンテキスト

ADR-0019で、component instanceが所有するcollectionのkey照合とList item直接更新を実装した。
複数instanceが同じmodule collectionを読む場合は、配列とkey selectorだけを共有し、Listの
DOM状態とitem状態をinstanceごとに持つ必要がある。module共有signalと同じく、共有accessorの
同期通知へ既存のinstance updateを接続すれば、汎用storeやschedulerを追加せずに解決できる。

## 決定

- `compileProject(entryPath)`では、module直下の単純な
  `const name = collection(initial, (item) => key)`だけを共有collectionとして受理する。
  `compile(source)`の単一file APIは変更しない。
- 参照されたcollectionを生成moduleのmodule scopeへ一度だけ出力する。accessorは配列の取得、
  全体置換、`update(key, updater)`、key selector、購読を持つ。
- 全体置換とitem更新は、現在のmounted instanceへ同期通知する。各instanceは通知を自身の
  `update_*()`へ接続し、Listのkey照合・DOM順序・binding cacheをinstance専有のruntimeへ渡す。
  module collection専用のDOM registryやList stateは作らない。
- module collectionを直接読むListは、collectionのkey selectorとitemの`key`属性を実行時に照合
  する。異なるkeyは既存のcollection identity errorで拒否する。
- 参照されないcollectionと、そこからしか到達しない共有stateは出力しない。永続化、request
  単位SSR分離、非同期scheduler、汎用store registryはADR-0038および別契約の範囲である。

## 検討した代替案

- **各instanceへcollectionを複製する**: module stateを共有する意味を失い、setterの結果が
  他instanceへ届かないため採用しない。
- **module collectionの配列を汎用shared signalで表す**: `update(key, updater)`のkey indexと
  selectorを別の生成処理へ漏らし、collection契約を失うため採用しない。
- **module scopeにList DOM stateも置く**: 複数mountとunmountの所有単位が衝突するため採用しない。
- **item更新だけ専用の共有DOM通知にする**: まず全体置換と同じ既存`update_*()`経路へ揃え、
  module collection専用の通知形式を増やさない。

## 結果と残る制約

複数のcomponent instanceが同じcollectionの配列を読み、一方の置換またはitem更新を全instanceへ
反映できる。未mountまたはunmount済みinstanceは購読しない。collection更新は各instanceの既存
List再調整を実行するため、ADR-0019のinstance専有item直接更新はmodule collectionでは使わない。
request SSRのstate分離と永続化は別契約である。
