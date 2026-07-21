## Why

authored `.jsx`(`examples/counter.jsx`、`examples/todomvc.jsx`)は現状
`tsconfig.json`の型検査対象外で、`signal`/`derived`/`render`のような
グローバルなauthoring API・JSX intrinsic要素(host属性・`onXxx`ハンドラ)・
`use=`属性のいずれにも型宣言が存在しない。ADR-0011は`use=`のJSX型定義
(`JSX.IntrinsicElements`の`use`宣言)を「authored `.jsx`の型検査基盤自体が
未整備」を理由に明示的に先送りしており(design.md Decision 6)、
ROADMAP.md次のアクション10がこの基盤整備を次の一手として指している。
型基盤が無いままではエディタの補完・型エラー検出が一切効かず、
`use=`を含む今後のJSX型拡張も積み増せない。

## What Changes

- `types/jsx.d.ts`を新設し、グローバル`JSX`namespace
  (`JSX.Element`・`JSX.IntrinsicElements`・`JSX.ElementChildrenAttribute`)と
  `signal`/`derived`/`render`のグローバル関数シグネチャを宣言する。
- `JSX.IntrinsicElements`は`lib.dom.d.ts`の`HTMLElementTagNameMap`から
  タグ名を導出し、共通属性(`key`・`use`・`onXxx`ハンドラ・`children`)を
  明示的に型付けした上で、それ以外の属性名は緩い`string`キーで許容する。
- `examples/tsconfig.json`を新設し(ルートの`tsconfig.json`は無変更)、
  `examples/**/*.jsx`を型検査対象にする(`allowJs`/`checkJs`/
  `jsx: preserve`を有効化。実装中にルートへ足すと
  `examples/*.handwritten.js`まで巻き込まれ既存の`@ts-expect-error`が
  壊れることが判明したため、examples専用の別プロジェクトへ切り出した。
  design.md参照)。
- `examples/counter.jsx`・`examples/todomvc.jsx`が新しい型定義下で
  `tsc --noEmit`を型エラーなく通過することを確認する。

スコープ外(明示):
- JSXの実行時セマンティクス変更。型はあくまで静的検査用で、
  コンパイラ(`src/compiler/*`)の受理/拒否ロジック(scope limit)には
  一切影響しない。型で「書ける」ことと実行時にコンパイルが通ることは
  別軸のまま(型はscope limitの代替にはならない)。
- コンポーネントprops(ADR-0014のshorthand分割代入)の厳密な型推論。
  必要最小限(`any`ベース)に留める。
- `src/`のコンパイラ実装そのものの変更(型宣言のみの変更)。

## Capabilities

### New Capabilities
- `authored-jsx-type-checking`: authored `.jsx`向けの型検査基盤
  (`types/jsx.d.ts` + `examples/tsconfig.json`)が満たすべき要件を定義する。

### Modified Capabilities
(なし ― 既存specの要件は変更しない)

## Impact

- 新規ファイル: `types/jsx.d.ts`・`examples/tsconfig.json`。
- 変更: `package.json`(`typecheck`スクリプトが`examples/tsconfig.json`も
  実行するよう2段構成へ)。ルートの`tsconfig.json`は無変更。
- 影響を受けるファイル: `examples/counter.jsx`・`examples/todomvc.jsx`
  (型検査が新たに効くようになる。実行時コード生成には影響しない)。
- `src/`配下のコンパイラ実装・ランタイムは無変更。
