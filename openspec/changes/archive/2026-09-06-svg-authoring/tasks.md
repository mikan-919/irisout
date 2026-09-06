## compiler

- [x] SVG namespaceを要素木、構造unit、`foreignObject`へ伝播する。
- [x] SVG要素上の静的namespace属性を受理し、動的値とSVG外を拒否する。
- [x] 通常のSVG動的属性を既存のsetAttribute更新へ接続する。

## types and tests

- [x] SVG intrinsic要素と静的namespace属性の型定義を追加する。
- [x] SVG namespace、動的属性、foreignObject、拒否境界を実DOMで確認する。
- [x] 型検査fixtureへSVG要素と属性を追加する。

## documentation and verification

- [x] ADR-0012/0042、README、STATUS、ROADMAP、CONCEPT、architectureを更新する。
- [x] canonical OpenSpecとこのchangeのspecを追加する。
- [x] 型検査、対象試験、全試験、check、build、OpenSpec厳格検証を実行する。
