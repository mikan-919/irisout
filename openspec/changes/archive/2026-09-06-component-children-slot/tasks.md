## compiler

- [x] 呼び出し側の意味のあるJSX子ノードを抽出し、`children` bindingの直接子位置へ展開する。
- [x] childrenを宣言しないcomponentと直接子位置以外の参照をscope limitで拒否する。
- [x] 展開後の子component、signal、handler、構造unitを既存解析へ接続する。

## fixture and tests

- [x] root componentのchildren slotを実DOMで確認する。
- [x] 複数子要素、動的式、handler、子componentの展開を確認する。
- [x] `notes.jsx`の共通パネルへchildren slotを適用する。
- [x] children prop未宣言と不正な参照位置の拒否を確認する。

## documentation and verification

- [x] ADR-0014/0041、README、STATUS、ROADMAP、CONCEPT、architectureを更新する。
- [x] canonical OpenSpecとこのchangeのspec deltaを更新する。
- [x] 型検査、対象試験、全試験、check、build、OpenSpec厳格検証を実行する。
