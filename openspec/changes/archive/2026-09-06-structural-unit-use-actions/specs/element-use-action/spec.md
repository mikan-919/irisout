## ADDED Requirements

### Requirement: 構造ユニット内のuse action
コンパイラは、`.map()` item、conditional branch、および任意の深さでネストした構造
unit内の要素へ`use=`を接続しなければならない(SHALL)。actionはそのunitのfactory
instanceが所有し、同一elementのmount中に一度だけ初期化しなければならない(SHALL)。

#### Scenario: list itemのaction
- **WHEN** `.map()`のitem要素に`use={setup}`がある
- **THEN** コンパイラはscope limitで拒否せず、itemのDOM挿入後に`setup(itemElement)`を
  一度呼び出す

#### Scenario: conditional branchのaction
- **WHEN** conditional branchの要素に`use={setup}`がある
- **THEN** 新しいbranchをDOMへ挿入した後に`setup(branchElement)`を一度呼び出す

#### Scenario: 任意のネストのaction
- **WHEN** list item、nested list、conditional branchが連続し、最内側の要素に`use=`がある
- **THEN** 各factoryが自身のactionを所有し、祖先の生成・更新・破棄と独立して動作する

### Requirement: 動的unitのaction lifecycle
既存keyのitemまたは同一branchが更新される場合、コンパイラは同じelementとaction resultを
再利用しなければならない(SHALL)。keyの並べ替えでは初期化・destroyを実行してはならず、
keyの脱落、branch切替、祖先unit破棄、root `unmount()`では各actionのdestroyを一度だけ
実行しなければならない(SHALL)。destroy後のupdate callbackはDOMまたは構造unitを更新して
はならない(SHALL NOT)。

#### Scenario: keyed reorderで再初期化しない
- **WHEN** item keyは同じまま配列順だけが変わる
- **THEN** 同じelement・action resultを使い、setupとdestroyを追加で呼ばない

#### Scenario: item削除でdestroyする
- **WHEN** item keyが配列から消える
- **THEN** item actionのdestroyを一度呼び、DOMとList recordを解放する

#### Scenario: branch切替で旧actionをdestroyする
- **WHEN** 条件分岐が別branchへ切り替わる
- **THEN** 旧branchのdestroyを呼んでから新branchを生成・挿入・初期化する

### Requirement: action resultの意味
`void`、関数返り値、`{ update?, destroy? }`を受理しなければならない(SHALL)。関数
返り値はupdateとしてmount直後と依存変更時に呼び、destroyとして呼んではならない
(SHALL NOT)。objectのdestroyはunmountまたは所有unitの破棄時だけ呼ぶ(SHALL)。

#### Scenario: item actionのupdate
- **WHEN** item actionがsignalを読むupdateまたはobject updateを返し、そのsignalが変化する
- **THEN** 生きているitem handleのupdateだけを呼び、action本体を再実行しない

#### Scenario: 関数返り値をcleanupにしない
- **WHEN** actionが関数を返してrootまたはunitが破棄される
- **THEN** その関数をdestroyとして呼ばない
