## MODIFIED Requirements

### Requirement: ネストした構造ユニットの再帰生成
コンパイラは、リストアイテム・条件分岐ブランチ内の構造ユニットを、深さを
固定値で制限せず再帰的に受理しなければならない(SHALL)。構造ユニットの
instanceごとにDOM範囲、ローカル状態、binding cache、更新処理を分離し、
内側unitの更新を所有者factoryへ接続しなければならない(SHALL)。

#### Scenario: 3階層以上のネストの受理
- **WHEN** リストアイテム、条件分岐、内側リストのように3階層以上の構造
  ユニットが連続する
- **THEN** コンパイラは深さを理由に`scope limit`で拒否せず、各unitのfactoryを
  親factoryの字句スコープへ生成し、mount・切り替え・更新・再生成を完了する

#### Scenario: リストアイテム内の条件分岐の受理
- **WHEN** authored コンポーネントのリストアイテムテンプレート内に条件
  分岐(例: 編集モードのspan/input切り替え)がある
- **THEN** コンパイラはリストアイテムのfactory関数の中に、条件分岐用の
  factory関数・update関数を生成し、itemごとに条件分岐の状態を分離する

#### Scenario: 条件分岐ブランチ内のリストの受理
- **WHEN** authored コンポーネントの条件分岐ブランチ内にリスト
  (`.map()`によるJSX生成)がある
- **THEN** コンパイラは条件分岐ブランチのfactory関数の中に、リスト用の
  factory関数・update関数(keyed reuse含む)を入れ子に生成する

### Requirement: ネストした構造ユニットのfactory生成
ネストした構造unitのfactory、keyed Map、binding cache、更新処理は、外側
factoryのinstanceごとに生成しなければならない(SHALL)。外側unitが破棄される
とき、内側unitの状態もDOM部分木とともに失われる。

#### Scenario: リストアイテム内の条件分岐のfactory生成
- **WHEN** リストアイテムのfactory関数が呼び出される
- **THEN** そのアイテム専用のDOM部分木の中に、内側の条件分岐用の
  `update_*`関数・factory関数がそのfactory関数のクロージャ内に生成され、
  アイテムごとに独立したインスタンスを持つ

#### Scenario: 条件分岐ブランチ内のリストのfactory生成
- **WHEN** 条件分岐の特定ブランチが選択され、そのブランチのfactory関数が
  呼び出される
- **THEN** そのブランチ専用のDOM部分木の中に、内側のリスト用の
  keyed reuse・factory関数がそのfactory関数のクロージャ内に生成され、
  ブランチが選択されている間だけ有効なkeyed Mapを持つ
