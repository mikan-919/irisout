# dynamic-attribute-bindings

## MODIFIED Requirements

### Requirement: attribute/property の固定表による更新反映

`checked`と`disabled`はbooleanプロパティ代入とし、初期HTMLはtrueのときだけ
presence属性を含める。falseへ更新したときはDOMプロパティをfalseにし、属性を
存在させてはならない。

#### Scenario: disabled false はボタンを無効にしない

- **WHEN** `disabled={busy()}`の初期値がfalseのボタンをmountし、接続ボタンを押す
- **THEN** ボタンの`disabled`プロパティはfalseで、接続処理が実行される
