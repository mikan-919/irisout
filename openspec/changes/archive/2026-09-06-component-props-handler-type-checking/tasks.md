## 1. 型宣言

- [x] 1.1 要素型付きイベント型と6イベント属性を`types/jsx.d.ts`へ追加し、型検査専用入力でイベント種別と`currentTarget`の型を確認する。
- [x] 1.2 任意の`onXxx`属性が関数を受理し、関数以外を拒否することを型検査専用入力で確認する。

## 2. コンポーネント境界

- [x] 2.1 同一ファイルと相対importのJSDoc付きコンポーネント検証用入力を追加し、必須項目、余分な項目、値型の成功例と失敗例を`tsc --noEmit`で確認する。
- [x] 2.2 TodoMVC、Notes、複数ファイル例のコンポーネントへJSDocを追加し、`bun run typecheck:tsc`と例のビルドが通ることを確認する。

## 3. 文書と検証

- [x] 3.1 型検査仕様、STATUS、ROADMAP、ADR-0009を現行契約へ更新し、OpenSpec検証を通す。
- [x] 3.2 `bun run check`、`bun run typecheck:tsc`、`bun run test`、`bun run build`を実行し、全検査が成功することを確認する。
