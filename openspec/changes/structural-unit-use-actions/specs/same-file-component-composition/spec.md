## ADDED Requirements

### Requirement: list itemへ展開したcomponentのuse action
同一ファイルcomponentがlist itemへインライン化され、そのrender JSXに`use=`がある場合、
コンパイラはactionをitem factoryのbodyへ移し、itemごとのelementへ接続しなければならない
(SHALL)。componentの動きゾーンfunction宣言も同じitem scopeで解決しなければならない
(SHALL)。

#### Scenario: component actionのitem単位初期化と破棄
- **WHEN** `<Row item={item} />`を`.map()`で生成し、`Row`が`<li use={track}>`をrenderする
- **THEN** 各itemの`track`は一度だけ初期化され、item削除時にそのitemだけdestroyされる

#### Scenario: 同じcomponentの複数item
- **WHEN** 同じcomponentが複数のlist itemへ展開される
- **THEN** action result、local signal、destroy状態はitem間で共有されない
