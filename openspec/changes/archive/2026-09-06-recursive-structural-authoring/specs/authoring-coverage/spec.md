## ADDED Requirements

### Requirement: authoring coverageをTodoMVCから分離する
fixtureには独立したcompile、mount、event、DOM assertionを持つ試験を追加し、
TodoMVCの性能値をauthoring coverageの証拠にしてはならない(SHALL NOT)。

#### Scenario: TodoMVCから独立した試験を実行する
- **WHEN** `packages/compiler/test/authoring-coverage.test.ts`だけを実行する
- **THEN** `notes.jsx`のcompile、mount、event、DOM assertionがTodoMVCの操作列や
  性能値なしで完了する

### Requirement: scope limitを隠さない
未対応構文に遭遇した場合、fixtureをcompiler専用の回避形へ変形せず、scope limitと
その範囲を記録しなければならない(SHALL)。

#### Scenario: 未対応構文の範囲を記録する
- **WHEN** fixtureがroot signalの直接動的属性など現在未対応の構文を必要とする
- **THEN** その構文を別の回避形へ変えず、仕様書またはfixtureのコメントに制約と
  適用範囲を記録する
