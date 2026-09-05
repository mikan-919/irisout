## ADDED Requirements

### Requirement: actionを持つ構造unitの所有と破棄
actionを持つlist itemまたはconditional branchは、既存のfactory handleへmount/destroyを
追加して生成しなければならない(SHALL)。Listのkey照合とDOM順序は既存の最小runtimeを
使い、action管理を必要とするListだけがlifecycle reconcile経路を使わなければならない
(SHALL)。

#### Scenario: item updateとkeyed reuse
- **WHEN** 既存keyのitem値が更新または配列順が変更される
- **THEN** factory handleのupdateとDOM順序だけを更新し、action初期化・destroyを実行しない

#### Scenario: 祖先unit破棄による子action解放
- **WHEN** actionを持つnested unitの外側itemまたはbranchが破棄される
- **THEN** 子unitを先に破棄し、子のList record・action・DOMを解放してから親actionを破棄する

### Requirement: actionなし構造unitの出力境界
actionを含まないlist/conditionalは既存のreconcileとfactory経路を維持し、action lifecycle
helperを生成物へ含めてはならない(SHALL NOT)。

#### Scenario: 未使用action経路を出力しない
- **WHEN** fixtureが`use=`を含まない
- **THEN** 生成コードにactionの初期化・destroy管理とlifecycle専用List helperを含めない
