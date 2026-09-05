# element-use-action

## Purpose

要素にaction(振る舞い)を接続するための、authoring API上の記法
(`use={identifier}`)とコンパイラ側の受理・解析・配線ルール(ADR-0011)。
ref primitiveは作らない — 要素は`use=`・イベント引数`e`・actionの
返り値クロージャの3チャネルを通じてのみ関数の引数として到着する。
top-level要素の`use=`に加え、リストアイテム・条件分岐ブランチ内の`use=`も
change `structural-unit-use-actions`で実装済み。各構造unitのfactory handleが
actionの初期化・update・destroyを所有する。JSX型定義はchange
`jsx-type-checking-foundation`で実装済みで、actionの返り値は従来の更新
クロージャに加えて`{ update?, destroy? }`形式を受理する(ADR-0022)。

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
ならない(SHALL)。リストアイテム/条件分岐ブランチ内の`use=`も、対応する
factory handleがDOMへ挿入された後に一度だけ呼び出さなければならない(SHALL)。

#### Scenario: mount時の呼び出し
- **WHEN** `<canvas use={setup} />`を含むコンポーネントがmountされる
- **THEN** 生成コードはマーカーからcanvas要素を取得し、
  `setup(<canvas要素>)`を1回呼び出す

#### Scenario: 接続後・populate後の呼び出し
- **WHEN** `setup`本体が要素の親(`el.parentElement`)や、signal依存の
  テキストマーカーの初期内容を参照する
- **THEN** 呼び出し時点で親要素が取得でき、テキストは初期値で埋まっている

#### Scenario: リストアイテム内のuse
- **WHEN** `.map()`のアイテムJSX内の要素に`use={setup}`がある
- **THEN** コンパイラはscope limitで拒否せず、item要素のDOM挿入後に
  `setup(item要素)`を一度呼び出す

#### Scenario: 条件分岐branch内のuse
- **WHEN** 条件分岐branch内の要素に`use={setup}`がある
- **THEN** 選択されたbranchのDOM挿入後に`setup(branch要素)`を一度呼び出し、
  branch切替時は旧actionを破棄してから新actionを初期化する

### Requirement: action本体の解析
コンパイラは、action本体をハンドラ本体(ADR-0009)と同じ規則で解析
しなければならない(SHALL): signal読みはプレーン変数読みに書き換え、
signal書き込みは代入+該当`update_*`呼び出しに書き換える。この書き換えは
action本体内にネストした関数(イベントリスナーのコールバック等)の本体
にも再帰的に適用する(SHALL)。actionの初期化・destroy本体では、初期化失敗と破棄例外を
表すため`throw`文も受理する。通常のハンドラと追跡functionの文種は
`handler-statement-bodies`の4文種を維持する。

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
しなければならない(SHALL)。list item/conditional branchでは、対応するfactoryの
mount時にも同じ規則で初期実行しなければならない(SHALL)。`return { update: () => ..., destroy: () => ... }`形式の
objectでは、`update`が同じタイミングで呼ばれ、`destroy`はunmount時だけ
保持・実行されなければならない。引数を持つ関数、または`update`/`destroy`
以外のプロパティを持つobject、関数以外の値を返す
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

#### Scenario: object形式の更新・破棄
- **WHEN** actionが`return { update() { ... }, destroy() { ... } }`を返す
- **THEN** `update`は初期実行と依存signalの更新時に呼ばれ、`destroy`は
  component instanceの`unmount()`時に登録順の逆順で一度だけ呼ばれる

#### Scenario: 返り値なしのaction
- **WHEN** actionが`return`を持たない(リスナー装着のみで終わる)
- **THEN** 生成コードはそのactionの配線行・初期実行行を含まない

### Requirement: component instanceのunmountとaction cleanup
生成されたcomponent instanceは`unmount()`を公開し、mount/hydrate済みのDOMから
top-level handlerを外し、top-levelと構造unit内のactionを所有者単位で破棄し、
List/conditional/template/markerの保持物を解放しなければならない(SHALL)。
`unmount()`は冪等で、実行後のsignal updateやaction updateは何もしてはならない
(SHALL NOT)。destroyが例外を投げても残りのcleanupを継続し、cleanup完了後に
最初の例外を再送出する SHALL。unmount済みinstanceを再mount/hydrateする操作は
拒否しなければならない(SHALL)。

#### Scenario: unmount後の更新停止
- **WHEN** component instanceを`unmount()`した後にsignalを更新する
- **THEN** DOM更新・action update・handler実行は発生しない

#### Scenario: destroy例外でもcleanupを継続する
- **WHEN** 複数actionの`destroy`の一つが例外を投げる
- **THEN** 後続のdestroyとinstance cleanupを実行した後、最初の例外を再送出する

### Requirement: 構造unitのaction依存
構造unit内actionの返り値`update`が読むroot signalは、そのunitのmarker更新へ接続
しなければならない(SHALL)。unitまたは祖先unitのlocal signalを読むupdateは、宣言した
factoryのupdateへ接続し、local DeclIdをroot依存表へ漏らしてはならない(SHALL NOT)。

#### Scenario: root signalでitem actionを更新する
- **WHEN** list item actionの`update`がroot signalを読み、そのsignalが更新される
- **THEN** 生きているitemのaction updateを呼び、action本体の初期化を再実行しない

#### Scenario: 祖先local signalでnested actionを更新する
- **WHEN** nested unit actionのupdateが祖先factoryのlocal signalを読む
- **THEN** 祖先factoryの更新からそのunit instanceだけへupdateを届ける

### Requirement: 初期化失敗と破棄例外の回収
action初期化またはfactory mountが途中で失敗した場合、生成コードとruntimeはすでに
取得したaction result、List record、DOMを回収しなければならない(SHALL)。destroyが
例外を投げても同じ所有者内の残りのaction・子unit・DOM解放を継続し、最初の例外を
呼び出し元へ再送出しなければならない(SHALL)。

#### Scenario: item action初期化途中の回収
- **WHEN** Listの後続itemのaction初期化が例外を投げる
- **THEN** 先に初期化済みのitemをdestroyし、作成済みitemとList recordを除去して
  初期化例外を再送出する

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
(`(el: <要素型>) => void | (() => void) | { update?: () => void; destroy?: () => void }`)
として宣言しなければならない
(SHALL)。第1引数の型にnull許容を含めてはならない(SHALL NOT)。

#### Scenario: 要素型の不一致の検出
- **WHEN** `(el: HTMLDivElement) => void`型の関数を`<canvas use={...}>`
  に渡す
- **THEN** エディタのTypeScript検査が代入可能性エラーを報告する
