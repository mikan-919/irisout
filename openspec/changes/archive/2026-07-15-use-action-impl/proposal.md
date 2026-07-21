## Why

ADR-0011(change `action-use-attribute`)で`use={fn}`の設計は決定済みだが
実装が無い。エスケープハッチ(`<Escape mount>`)の棚上げ(2026-07-14、
ADR-0010「棚上げの経緯」)により、`use=`は「使ってもらえる閾値
(M5+`use=`)」の最後のピースであると同時に、scope limitからの公式な
逃げ道(action本体からのグローバル委譲)を兼ねることになった。

## What Changes

- `src/compiler/render.ts`: `use`属性の解析 — ハンドラと同じ識別子参照
  ルール(動きゾーンのfunction宣言/inline arrow)での解決、それ以外の
  拒否。
- `src/compiler/analyze.ts`: action本体へのADR-0009解析機械の適用と、
  ネストした関数本体への再帰書き換え(ADR-0011決定4)、返り値クロージャの
  依存(signal/derived読み)解析(決定5)。
- `src/codegen.ts`: mount/hydrate時のaction呼び出し(要素接続後・1回)、
  返り値クロージャの保持・初期1回実行・該当`update_*`への配線。
- スコープ制限: 本changeは**top-level要素のみ**。リストアイテム/条件分岐
  ブランチ内の`use=`はscope limitで拒否する(理由はdesign.md参照)。
- ADR-0011の未決定事項のうち実装に必要な2件をdesign.mdで裁定する:
  (1) 属性名`use`の最終確認、(2) 返り値クロージャの初期実行タイミング。
- JSX型定義(`JSX.IntrinsicElements`の`use`宣言)は本changeのスコープ外
  (authored .jsxの型検査基盤自体が未整備のため。design.md参照)。

## Capabilities

### New Capabilities

(なし)

### Modified Capabilities

- `element-use-action`: 実装可能な水準への具体化。呼び出しタイミング
  (要素接続後・初期`update_*`後)を要件化し、本changeのスコープ制限
  (リスト/条件分岐ユニット内の`use=`はscope limitで拒否)と、JSX型宣言
  要件の実装先送り(要件自体は維持)を反映する。

## Impact

- 影響コード: `src/compiler/render.ts`・`src/compiler/analyze.ts`・
  `src/codegen.ts`。エラー書式は`docs/conventions.md`に従う。
- テスト: 受理/拒否・生成コード・実行時挙動(mount時1回呼び出し・
  返り値クロージャ配線)を`test/`に追加。
- ドキュメント: ADR-0011ステータス更新、STATUS.md(制約: ユニット内
  `use=`未対応・型宣言未実装)、ROADMAP(6c消し込み)。
