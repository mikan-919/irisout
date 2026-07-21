# scope-limit-coverage

## Why

規約(docs/conventions.md)は「未対応構文は必ず `compile:` エラーにする」と
定めるが、2つの経路がそれをすり抜ける(レビューで実証済み):
(a) `const [a] = signal(0)` のような分割代入宣言子は無検証キャスト
(`src/compiler/render.ts` の `declarator.id as t.Identifier`)を通過し、
ビルド時実行の生 `ReferenceError: a is not defined` で落ちる。
(b) コンポーネント外のトップレベル文(`const TAX = 1.1` 等)は黙って
無視され、参照時に生 `ReferenceError: TAX is not defined` で落ちる。
どちらもユーザーに原因を伝えない。

## What Changes

- 宣言子の `id` が単純な `Identifier` でない場合(分割代入等)、
  `compile: ... (scope limit)` で明示拒否する。
- ルートコンポーネント関数(と他のトップレベル関数宣言)・import 以外の
  トップレベル文を `compile: ... (scope limit)` で明示拒否する — 「黙って
  捨てる」経路を塞ぐ。
- ビルド時実行(`new Function`)の例外を捕捉し、`compile:` プレフィックス
  付きのエラーに包んで再 throw する(残りの取りこぼしの安全網)。

## Capabilities

### New Capabilities

- `compile-error-coverage`: 非対応のトップレベル構文・宣言子形状が生の
  実行時エラーではなく `compile:` エラーで拒否されること。

### Modified Capabilities

(なし — 既存 spec に該当要件はない)

## Impact

- `src/compiler.ts`: トップレベル文の検証、ビルド時実行の例外ラップ。
- `src/compiler/render.ts`: `processDeclarationStatement` の宣言子 id 検証。
- `test/`: 各拒否経路の scope limit テスト(規約「新しい scope limit を
  足したら、その error を踏むテストも足す」)。
