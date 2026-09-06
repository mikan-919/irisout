## 問題

同一ファイルcomponentは`<Component/>`だけを受理していた。共通パネルの表示枠を
componentへ切り出すには、呼び出し側の`<Panel>...</Panel>`を本体へ渡すchildren slotが
必要である。

## 変更

- `function Panel({ children })`の直接JSX子slotを受理する。
- 呼び出し側の意味のある子ノード列を`{children}`の直接子位置へAST展開する。
- 展開後の子ノードを既存のsignal、event、構造unit、component解析へ渡す。
- `children` propを宣言しないcomponent、直接子位置以外の参照、既存render-treeが
  受理しない子ノードの形はscope limitで拒否する。

## 非目標

- 実行時props object、slot配列、仮想DOM、専用slot runtime。
- JSX fragmentやspread childなど既存render-tree未対応形式の拡張。
- 複数ファイルcomponentの解決と再帰・循環component参照。
