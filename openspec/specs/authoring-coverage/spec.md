# authoring-coverage

## Purpose

TodoMVCの機能試験や性能計測とは別に、作者が自然なJSXで画面を組める範囲を
確認する。fixtureはcompiler専用のmarker、手書きDOM操作、構造を変えるための
回避用stateを持ち込まず、実用画面の形で複数機能を同居させる。

## Requirements

### Requirement: 実用画面の自然なJSX fixture
リポジトリは、フォーム、タブ、条件分岐、リスト、同一ファイル内の複数
コンポーネント、コンポーネントごとのローカルstateを含むfixtureを
`apps/examples/notes.jsx`へ持たなければならない(SHALL)。fixtureは通常の
JSX要素、`.map()`、三項式または`&&`、イベントハンドラ、`signal()`/
`derived()`で記述し、compilerの生成規則に合わせるためだけのDOM構造を
要求してはならない(SHALL NOT)。

#### Scenario: formとtabsが同じ画面で動く
- **WHEN** `notes.jsx`をcompileしてmountし、入力、保存、タブ切り替えを行う
- **THEN** 入力値から新しいnoteが追加され、Open/Archivedの表示集合が切り替わる

#### Scenario: local stateと入れ子構造が動く
- **WHEN** List item内のコンポーネントがlocal signalで条件分岐を切り替え、
  選択されたbranch内にさらにListを持つ
- **THEN** itemごとの展開状態が分離され、branchの切り替えと内側Listの表示が
  動作する

### Requirement: authoring範囲の独立した実DOM試験
authoring fixtureには、TodoMVCの操作列や性能値に依存しないcompile、mount、
実DOMイベント、表示結果の試験を持たなければならない(SHALL)。試験は
`packages/compiler/test/authoring-coverage.test.ts`に置き、fixtureの機能軸を
TodoMVCの回帰試験から分離する。

#### Scenario: fixtureが本番build経路を通る
- **WHEN** `IRISOUT_ENTRY=notes.jsx`でexamplesのbuildを実行する
- **THEN** 初期HTMLとhydrate用JavaScriptが生成され、compile errorを出さない

### Requirement: scope limitの記録
fixtureが現在のcompilerのscope limitに依存する場合、その構文を無理に
別のauthoringへ変形せず、fixtureまたは仕様書に理由と適用範囲を記録しなければ
ならない(SHALL)。scope limitを隠すためのcompiler専用回避コードをfixtureへ
追加してはならない(SHALL NOT)。

#### Scenario: 未対応の機能は別軸として残す
- **WHEN** root signalの直接動的属性、複数ファイルimport、children/slot、
  unit内`use=`などがfixtureの要求に現れる
- **THEN** 対応を捏造せず、`scope limit`または未対応事項として記録し、
  authoring coverageの既存機能試験を維持する
