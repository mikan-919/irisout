# list-conditional-rendering delta

## ADDED Requirements

### Requirement: ユニットホスト要素のハンドラ配線
構造ユニット(リスト/条件分岐)を唯一の子に持つ要素に `on[A-Z]...`
ハンドラ属性がある場合、コンパイラはそのハンドラをユニットのマーカー id
へ配線しなければならない(SHALL)。黙って捨ててはならない(従来は
silent drop になっていた)。

#### Scenario: リストホスト要素の onClick
- **WHEN** `<ul onClick={handler}>{items().map(...)}</ul>` を含むソースを
  `compile()` して mount する
- **THEN** 生成コードは `ul` 要素へのイベントリスナー配線を含み、click
  発火でハンドラが実行される
