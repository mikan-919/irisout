## 1. 型宣言ファイル

- [x] 1.1 `types/jsx.d.ts`を新設し、グローバル`JSX`namespace
  (`Element`・`ElementChildrenAttribute`・`IntrinsicElements`)を宣言する
  (design.md Decision 1/3)。
- [x] 1.2 `JSX.IntrinsicElements`に`HTMLElementTagNameMap`由来のタグ名を
  列挙し、共通属性(`key`・`use`・`onXxx`ハンドラ・`children`)を明示的に
  型付けした上で、それ以外の属性名を緩い`string`キーで許容する
  (design.md Decision 3/5)。
- [x] 1.3 `signal`/`derived`/`render`のグローバル関数シグネチャを宣言する
  (design.md Decision 4。`declId`は公開APIに含めない)。

## 2. tsconfig 組み込み

- [x] 2.1 `tsconfig.json`の`include`に`examples/**/*.jsx`を追加する。
- [x] 2.2 `compilerOptions`に`allowJs: true`・`checkJs: true`・
  `jsx: "preserve"`を追加する(design.md Decision 1/2)。

## 3. 検証

- [x] 3.1 `bun run typecheck`(`tsc --noEmit`)を実行し、
  `examples/counter.jsx`・`examples/todomvc.jsx`が型エラーなく通ることを
  確認する。
- [x] 3.2 スクラッチ(コミットしない一時ファイル)で意図的に型エラーに
  なるはずのケース(存在しないタグ名・`signal`の初期値と異なる型の書き込み・
  未宣言グローバル関数呼び出し)を試し、実際に`tsc`が検出することを
  手動確認する(spec.mdの各scenario)。
- [x] 3.3 `bun run check-all`(biome check --write → tsc --noEmit →
  bun test)を実行し、`src/`の既存実装・テストに regression が無いことを
  確認する。

## 4. ドキュメント整合

- [x] 4.1 `docs/adr/0011-element-use-action.md`の「実装への引き継ぎメモ」
  (`use`のJSX型定義を先送りした旨の記述)を、本changeで解消した旨に更新する。
- [x] 4.2 `ROADMAP.md`次のアクション10を完了として更新する
  (ステータス情報は`STATUS.md`側、本項目は完了マークのみ)。
- [x] 4.3 `STATUS.md`に本change(型検査基盤の追加)を現在地として記載する。
- [x] 4.4 実装完了後、design.md/spec.mdの記述が実際の`tsconfig.json`差分・
  `types/jsx.d.ts`の中身と一致しているか最終確認する(直近PRで
  design.md/spec.mdの記述ズレを指摘された教訓を踏まえる)。
