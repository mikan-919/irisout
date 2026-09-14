# browser-compiler-entry Specification

## Purpose
単一のIrisout JSXをNodeのファイル読込み機能へ依存せずブラウザ内で変換し、既存の対応範囲と診断をPlaygroundの隔離実行へ渡せるようにする。

## Requirements

### Requirement: 単一JSXのブラウザ変換

公開されたブラウザ用入口は、単一`.jsx`のソース文字列を受け取り、Irisoutの初期HTML、生成コード、診断を返さなければならない(SHALL)。ファイルパス、要求オブジェクト、Nodeのファイル機能を入力契約に含めてはならない(SHALL NOT)。

#### Scenario: 単一ファイルの変換

- **WHEN** 対応する単一`.jsx`ソースをブラウザ用入口へ渡す
- **THEN** サーバーのファイル読込みなしに初期HTMLとブラウザ用生成コードを取得できる

### Requirement: 既存記法と診断の一致

ブラウザ用入口は、単一ファイルと同一ファイル内の部品について、既存`compile()`と同じ対応範囲と`compile:`診断の形式を使わなければならない(SHALL)。

#### Scenario: 対応例の回帰

- **WHEN** Counter、List、SVGを同じ版の既存入口とブラウザ用入口へ渡す
- **THEN** 生成HTML、生成コードの動作、診断の有無が一致する

### Requirement: 外部依存の拒否

初期ブラウザ入口は静的import、動的import、外部module、外部資源を解決または実行してはならず(SHALL NOT)、対象を示すscope limit診断を返さなければならない(SHALL)。

#### Scenario: 外部moduleを含む入力

- **WHEN** 単一JSXが外部moduleをimportする
- **THEN** 入力を実行せず、対応外であることを示す診断を返す
