## Why

irisoutは現在、コンパイラが受理しないパターンに当たると`scope limit`で
コンパイルエラーになり、コンポーネント全体(1つの未対応パターンがページ
全体を止める構造)がビルドできなくなる。手書きvanilla JSとの共存を認める
公式な逃げ道がまだ無いため、パリティの薄い箇所に当たった時点でプロジェクト
全体が詰む。ROADMAP.mdでは「機能パリティを広げるより優先度が高くなり得る」
と2026-07-14に相談済みだが、設計(共存の単位を要素にするかゾーンにするか)は
未着手で、決定するADRが無い。

## What Changes

- コンパイラが受理しないパターンに遭遇した箇所を、手書きvanilla JSとして
  共存させるための公式な単位(要素単位/ゾーン単位、あるいは他の単位)を
  決定するADRを起票する。
- 決定した単位に基づき、authoring API側の記法(既存のゾーン化API
  ADR-0008との整合性を含む)と、コンパイラ側の受理条件を仕様として定義する。
- 本changeでは設計決定(ADR)と対応するspec.mdの作成までをスコープとし、
  コンパイラ実装(`src/`)そのものは対象外とする。実装は決定内容に基づく
  別changeとして起こす。

## Capabilities

### New Capabilities
- `handwritten-js-escape-hatch`: コンパイラ非対応パターンに遭遇した部分を
  手書きvanilla JSとして共存させるための、authoring API上の記法と
  コンパイラ側の受理ルール(設計のみ。実装は別change)。

### Modified Capabilities
(なし。既存の`component-authoring-zones`との整合性は設計時に確認するが、
既存specの要求自体を変更するかは設計結果次第 — design.mdで判断する)

## Impact

- 影響ドキュメント: `docs/adr/`(新規ADR)、`docs/architecture.md`
  (該当すれば)。
- 影響コード: 本changeでは無し(設計決定のみ)。決定後の実装は別change。
- ROADMAP.mdの「設計判断待ち」3番目の項目を解消する。
