# ADR-0030: module共有signalの静的境界

## ステータス

**決定済み・実装済み**(2026-09-06)。`compileProject`のリンク済みmoduleに限り、直接の
module共有signalを受理する。module共有derivedの後続判断はADR-0037で定める。

## コンテキスト

ADR-0024はcomponentを複数fileへ分割する入口を追加したが、module scopeのstateを一律に
拒否した。そのため、複数の生成component instanceが同じ値を読む小さな共有状態を、
module外の手書きruntimeへ逃がさずに表現できなかった。一方、module共有stateを汎用storeや
暗黙のschedulerとして実装すると、未使用生成物へ固定費を載せ、SSR分離や所有権の意味を
未決定のまま持ち込む。

## 決定

- `compileProject(entryPath)`では、module直下の単純な`const name = signal(initial)`だけを
  共有signalとして受理する。`compile(source)`は従来どおりmodule scope stateを受理しない。
- 参照された共有signalを生成moduleのmodule scopeへ一度だけ出力する。各component instanceは
  自身の`update_*()`を購読し、`unmount()`時に解除する。setterの通知は同期で行う。
- 共有signalのread/writeは生成後も`name()`/`name(next)`として残す。これにより全instanceが
  同じcellを読み、DOM更新は既存の専用依存経路へ接続される。
- 共有signalを使わない生成物には、共有helper import、宣言、購読slotを出力しない。
- module scopeの`collection`、永続化、request単位SSR分離、非同期scheduler、汎用store
  registryは対象外とする。module共有derivedは、derived専用のcacheやschedulerを持たない
  別契約としてADR-0037で定める。

## 検討した代替案

- **全module stateを拒否し続ける**: 複数moduleのcomponent間で共有値を表せず、代表的な
  module分割用途を閉じたままになるため採用しなかった。
- **汎用store/context registryを追加する**: inline済みcomponent treeの既存依存グラフで
  解決できる範囲を越え、未使用時の固定費と所有権・SSR意味論を追加するため採用しなかった。
- **module共有derived/collectionもsignalと同時に受理する**: 再計算・keyed item状態の所有者を
  同時に定義する必要があり、signalの同期購読という最小縦切りから逸脱するため採用しない。

## 結果と残る制約

二つ以上のcomponent instanceが同じmodule signalを読み、どれかのinstanceのsetterで全ての
mounted instanceを更新できる。unmount済みinstanceは購読解除される。module共有signalの
初期値はbuild-timeと生成moduleで同じ式を一度ずつ評価するため、初期値は副作用を持たない
式に限る。複雑なstore、module共有collection、request単位の分離は別契約である。
module共有derivedの直接形はADR-0037で追加したが、collection共有とrequest単位の分離は
引き続き対象外である。
