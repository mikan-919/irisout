# element-use-action

## Purpose

要素にaction(振る舞い)を接続するための、authoring API上の記法
(`use={identifier}`)とコンパイラ側の受理・解析・配線ルール(ADR-0011)。
ref primitiveは作らない — 要素は`use=`・イベント引数`e`・actionの
返り値クロージャの3チャネルを通じてのみ関数の引数として到着する。
top-level要素の`use=`はchange `use-action-impl`で実装済み。リストアイテム/
条件分岐ブランチ内の`use=`(返り値クロージャの動的レジストリが必要)と
JSX型定義(要素ごとの`use`属性の型宣言、authored `.jsx`の型検査基盤が
未整備なため)は別change待ち。

## Requirements

### Requirement: `use`属性の受理と識別子参照ルール
コンパイラは、JSX要素の`use`属性を、ハンドラ属性
(`component-authoring-zones`)と同じ規約で解決しなければならない
(SHALL): `render()`より後ろに置かれたfunction宣言への識別子参照、
またはinline arrowを受理し、それ以外(`render()`より前の宣言への参照
など)は`compile:`で始まり`(scope limit)`を末尾に含むエラーで拒否する。

#### Scenario: 動きゾーンのfunction宣言への参照
- **WHEN** `<canvas use={setup} />`があり、`setup`が`render()`より後ろの
  function宣言として存在する
- **THEN** コンパイラは参照を解決し、mount時に`setup`を呼び出すコードを
  生成する

#### Scenario: 未解決の識別子参照の拒否
- **WHEN** `use={setup}`の`setup`が`render()`より後ろのfunction宣言と
  して存在しない
- **THEN** コンパイラは`compile:`で始まり`(scope limit)`を末尾に含む
  エラーを投げる

### Requirement: mount時の1回呼び出しと要素引数
コンパイラが生成するコードは、コンポーネントのmount/hydrate時に、`use`が
参照する関数を、その要素を第1引数として1回だけ呼び出さなければならない
(SHALL)。呼び出しの順序はマーカー収集・ハンドラ配線・初期`update_*`
(populate)の後とし、呼び出し時点で要素は`mountComponent`/
`hydrateComponent`に渡されたcontainer配下のDOMに接続済みでなければ
ならない(SHALL)。リストアイテム/条件分岐ブランチ内の`use=`は、
`compile:`で始まり`(scope limit)`を末尾に含むエラーで拒否しなければ
ならない(SHALL — 返り値クロージャの動的レジストリが必要になるため、
実需が出た時点で別changeで対応する)。

#### Scenario: mount時の呼び出し
- **WHEN** `<canvas use={setup} />`を含むコンポーネントがmountされる
- **THEN** 生成コードはマーカーからcanvas要素を取得し、
  `setup(<canvas要素>)`を1回呼び出す

#### Scenario: 接続後・populate後の呼び出し
- **WHEN** `setup`本体が要素の親(`el.parentElement`)や、signal依存の
  テキストマーカーの初期内容を参照する
- **THEN** 呼び出し時点で親要素が取得でき、テキストは初期値で埋まっている

#### Scenario: リストアイテム内のuseの拒否
- **WHEN** `.map()`のアイテムJSX内の要素に`use={setup}`がある
- **THEN** コンパイラは`compile:`で始まり`(scope limit)`を末尾に含む
  エラーを投げる

### Requirement: action本体の解析
コンパイラは、action本体をハンドラ本体(ADR-0009)と同じ規則で解析
しなければならない(SHALL): signal読みはプレーン変数読みに書き換え、
signal書き込みは代入+該当`update_*`呼び出しに書き換える。この書き換えは
action本体内にネストした関数(イベントリスナーのコールバック等)の本体
にも再帰的に適用する(SHALL)。

#### Scenario: ネストしたリスナー内のsignal書き込み
- **WHEN** action本体の
  `canvas.addEventListener('click', () => { count(count() + 1) })`が
  コンパイルされる
- **THEN** 生成コードのコールバックは`count = count + 1`相当の代入と
  `update_count()`の呼び出しを含む

### Requirement: 返り値クロージャのリアクティブ配線
actionが引数なしのクロージャを本体トップレベルの`return`で返す場合、
コンパイラはその依存(signal/derived読み)を解析し、該当するすべての
`update_*`からそのクロージャを呼び出すコードを生成しなければならない
(SHALL)。生成コードはaction呼び出しの直後にこのクロージャを1回実行
しなければならない(SHALL)。引数を持つ関数や関数以外の値を返す
`return`は、`compile:`で始まり`(scope limit)`を末尾に含むエラーで
拒否しなければならない(SHALL)。actionが何も返さない場合、配線・
初期実行のコードを生成してはならない(SHALL NOT)。

#### Scenario: canvas再描画の配線
- **WHEN** actionが`count()`を読むクロージャを返す
- **THEN** `update_count()`はそのクロージャの呼び出しを含み、action
  呼び出しの直後にも1回実行される

#### Scenario: 引数付き関数の返却の拒否
- **WHEN** actionが`return (x) => { ... }`のように引数を持つ関数を返す
- **THEN** コンパイラは`compile:`で始まり`(scope limit)`を末尾に含む
  エラーを投げる

#### Scenario: 返り値なしのaction
- **WHEN** actionが`return`を持たない(リスナー装着のみで終わる)
- **THEN** 生成コードはそのactionの配線行・初期実行行を含まない

### Requirement: 位置的リアクティビティ(返り値以外は配線しない)
コンパイラは、action本体内のネストした関数(返り値クロージャを除く)を
いかなる`update_*`にも配線してはならない(SHALL NOT)。それらの関数内の
signal読みは、実行時点の現在値を返すプレーン変数読みである。

#### Scenario: rAFループは現在値を読むだけ
- **WHEN** action本体が`count()`を読むrequestAnimationFrameループを開始し、
  そのループを返り値として返していない
- **THEN** `update_count()`はこのループへの参照を含まず、ループは各
  フレームで実行時点の`count`の現在値を読む

### Requirement: 要素ごとの型宣言
irisoutが提供するJSX型定義は、各intrinsic要素の`use`属性を、その要素の
正確なDOM型を第1引数とする関数型
(`(el: <要素型>) => void | (() => void)`)として宣言しなければならない
(SHALL)。第1引数の型にnull許容を含めてはならない(SHALL NOT)。

#### Scenario: 要素型の不一致の検出
- **WHEN** `(el: HTMLDivElement) => void`型の関数を`<canvas use={...}>`
  に渡す
- **THEN** エディタのTypeScript検査が代入可能性エラーを報告する
