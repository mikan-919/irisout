# ADR-0037: module共有derivedの静的境界

## ステータス

**決定済み・実装済み**(2026-09-06)。`compileProject`のリンク済みmoduleに限り、直接の
module共有derivedを受理する。

## コンテキスト

ADR-0030で直接のmodule共有signalを実装した。signalから計算する値を複数のcomponent
instanceで共有するには、module scopeのderivedを別契約として定める必要がある。
derivedに専用の値保持、購読registry、schedulerを加えると、signalの同期通知と既存の
依存グラフの範囲を越える。現時点では、derivedを読む式が各instanceの更新経路で再評価
されれば要件を満たす。

## 決定

- `compileProject(entryPath)`では、module直下の単純な
  `const name = derived(() => expression)`だけを共有derivedとして受理する。引数は0個の
  concise arrowで、本文は一つの式に限る。`compile(source)`の単一file APIは変更しない。
- 参照された共有derivedは、生成moduleのmodule scopeへ`const name = () => expression`として
  一度だけ出力する。生成物ではruntimeの`derived()`を呼ばず、derivedの呼び出しは
  `name()`として残す。
- 共有derivedの依存は既存の`derivedDeps`と`resolveToSignals()`へ登録する。shared signalに
  到達する場合、各component instanceがshared signalの同期通知を購読し、自身の
  `update_*()`で共有derivedを読む。shared derived自身へ購読処理は追加しない。
- 共有derivedは読み取り専用とする。生成コードの値を書き換えるinstance専有の再計算代入は
  持たせず、引数付き呼び出しは`compile:`エラーで拒否する。
- 参照されない共有derivedと、そのderivedからしか到達しない共有signalは出力しない。
  collection共有、永続化、request単位SSR分離、非同期scheduler、汎用store registryは
  この契約に含めない。

## 検討した代替案

- **shared derivedへcacheと購読registryを追加する**: signalの同期通知と既存の依存グラフで
  解決できる範囲を越え、未使用時の生成物と所有権を増やすため採用しない。
- **derivedを各component instanceで生成する**: module stateの値を共有する意味を失い、
  複数instanceへ同じ定義を出力するため採用しない。
- **module共有collectionも同時に受理する**: key付きitem状態の所有者、更新、破棄を定義
  する必要があり、この変更の依存更新の範囲を越えるため採用しない。

## 結果と残る制約

module共有derivedの式は、shared signalのsetter後に各instanceのmarker更新で再評価される。
shared signalへ依存しないderivedは、初期HTMLの生成時と各component instanceの初期化時に
読み取られるが、更新通知元を持たない。derivedの値を明示的に保持するcacheはないため、
getterの副作用や非同期schedulerを意味論へ追加しない。SSRのrequest単位分離、永続化、
collection共有は未決定である。
