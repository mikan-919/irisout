## Why

contextの静的provider値は実装済みだが、条件分岐やlist itemの生存期間に応じたprovider
treeの切替を受入条件として明記していなかった。既存factoryが所有するprovider値を
consumerへ接続し、runtime objectを増やさず動的な画面例を扱う。

## What Changes

- conditional branchとkeyed list itemのproviderをfactory単位で解決する。
- branch切替とitem再利用でprovider値の字句範囲を分離する。
- provider値のroot/local signal依存を既存更新経路へ合流する。

## Non-goals

- 任意のruntime component object、children/slot Provider、非同期context、module共有state。
- 汎用context registry、Map、stack、tree traversal。

## Impact

- ADR-0027を動的provider treeの境界へ更新し、ADR-0028を追加する。
- context受入試験へconditional provider switchを追加する。
