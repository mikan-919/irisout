## MODIFIED Requirements

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
