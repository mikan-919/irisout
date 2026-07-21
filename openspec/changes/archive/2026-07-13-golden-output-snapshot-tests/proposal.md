## Why

`CONCEPT.v2.md` の主張は「経験豊富な JavaScript 開発者が手作業で書いたで
あろうコード」を出力することだが、現在の `test/` は jsdom 上の**挙動**しか
検証しておらず、生成コードの**形とサイズ**は何も固定していない。これから
M4(静的host属性)→ ADR-0008(ゾーンAPI)→ M5(factory closure)と codegen が
大きく動く期間、不要なラッパー混入や出力の肥大といった退行は着地するまで
見えない。生成コードのスナップショットとサイズ予算を `bun run check-all`
相当に組み込むことで、出力品質を毎コミット検証可能にする。M4 とは独立に
今すぐ着手できる。

## What Changes

- 既存の代表フィクスチャ(M1: signal+derived の counter、M2: onClick
  ハンドラ付き counter)の `compile(...).code` / `initialHtml` をスナップ
  ショットとして固定するテストを追加する。
- 同一ソースを2回 `compile()` した結果が完全に一致すること(決定論)を
  検証するテストを追加する。
- 手書き基準ファイル `examples/counter.handwritten.js`(experienced
  developer が hydrate 前提で書いたと仮定した素の DOM API コード)を追加し、
  `scripts/build.ts` が生成する `dist/app.js` のバイトサイズをこれと比較する
  サイズ予算テストを追加する(初期係数は手書きの3倍)。
- スナップショットに `signal(`/`derived(` という文字列が含まれないことを
  検証し、ADR-0006(生成コードから signal ラッパーが消えるという決定)の
  回帰チェックとする。
- **プロダクトコード(`src/**`)は一切変更しない**。出力の形が気に入らなくても
  そのまま記録する ― 出力の改善は別の変更の仕事。

## Capabilities

### New Capabilities

- `generated-output-regression-tests`: 生成コードの構造(スナップショット)
  とサイズ(手書き比較の予算)の退行を検出するテストスイート。

### Modified Capabilities

(なし ― プロダクトの振る舞い自体は変更しない)

## Impact

- `test/golden.test.ts`(新規): スナップショット2ケース + 決定論1ケース +
  サイズ予算1ケース。
- `test/__snapshots__/golden.test.ts.snap`(新規、`bun test` が自動生成し
  git 管理下に置く)。
- `examples/counter.handwritten.js`(新規、サイズ比較の分母)。
- 依存: なし。他のどの変更(M4/ADR-0008/M5)にも先行して独立に実行できる。
  逆に M4/ADR-0008/M5 が着地するたびに、このスナップショットの diff が
  レビュー材料になる。
