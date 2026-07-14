## Why

ADR-0008はref(要素参照)の設計を未決定事項として明示し、ROADMAP.mdの
UNRESOLVED(01)として残っていた。2026-07-14の設計相談で、Svelte Action風の
`use={fn}`属性(要素の存在が確定した状態で、型付き・null無しの引数として
要素を受け取る)を採用し、ref primitiveそのものは作らない方針に収束した。
また相談を通じて、authoring API全体を貫く設計原則(穴のない宣言・
プレースホルダーの向き・位置的リアクティビティ)が言語化された。これらを
ADRとspecに固定する。

## What Changes

- authoring APIの設計原則3つ(穴のない宣言/プレースホルダーの向き/
  位置的リアクティビティ)を新ADRに明文化する。
- `use={identifier}`属性を新規capabilityとして仕様化する: 動きゾーンの
  function宣言への識別子参照、mount時1回呼び出し、返り値クロージャの
  リアクティブ配線、本体へのADR-0009解析の適用(ネスト関数への再帰拡張)。
- ref primitiveを「作らない」決定として記録する(要素アクセスの3チャネル
  と、残余ケースのtriage手順・第4チャネルのトリガー条件を含む)。
- 本changeは設計決定(ADR)とspec作成までをスコープとし、コンパイラ実装は
  別change。

## Capabilities

### New Capabilities
- `element-use-action`: `use={fn}`属性による要素へのAction接続(設計のみ。
  実装は別change)。

### Modified Capabilities
(なし。`component-authoring-zones`の識別子参照ルールを再利用するが、
既存specの要求自体は変更しない)

## Impact

- 影響ドキュメント: `docs/adr/`(新規ADR-0011)、ROADMAP.mdの
  UNRESOLVED(01)を解消。
- 影響コード: 本changeでは無し(設計決定のみ)。
- escape-hatch-design changeとの関係: `<Escape mount>`とuse=は同じ配線
  パターンの2変種で、「本体をコンパイラが解析するか」の1軸で区別する
  (escape-hatch側design.mdにも役割分担を追記)。
