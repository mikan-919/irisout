# ADR-0028: 構造unitの動的provider tree

## ステータス

**決定済み・実装済み**(2026-09-06)。動的なDOM treeをruntime registryへ登録せず、既存の
conditional/list factoryが所有する字句範囲へproviderを接続する。

## 決定

- `provideContext(key, value)`を構造unit直下の式文、またはJSX式コンテナで受理する。
- list item、conditional branchごとにprovider値を解析し、そのunit内でinlineされたconsumer
  へ最も近い値を静的置換する。branchの切替では旧factoryを破棄し、新factoryのprovider
  値を評価する。
- provider値が現在unitまたは祖先unitのlocal signal、root signalを読む場合は、既存の
  dependency markerへ合流してunit更新を駆動する。字句範囲外のlocal signalは拒否する。
- `createContext`のkey、Map、stack、provider registry、汎用runtime traversalは生成しない。

## 境界

runtimeで生成された任意のcomponent object間のprovider伝播、children/slotを持つProvider
wrapper、非同期provider、provider値の遅延Promise解決は対象外である。動的性はcompilerが
認識するlist/conditionalのfactory生存期間と、その値式のsignal依存に限る。

## 根拠

inline componentにはruntime child instanceがなく、provider treeの所有者は構造unit factory
で既に確定している。既存のcontext値置換とmarker依存を再利用する方が、未使用contextの
固定費と独立instance間の共有を増やさない。
