## Context

`src/compiler.ts` の `compile(source)` は `{ code, initialHtml, ... }` を
返す。`code` は完全な ES モジュール文字列で、`src/codegen.ts` は決定論的
(同じ入力ソースなら同じ出力文字列、マーカー ID は連番、`Date.now()` 等は
不使用)。既存の `test/counter.test.ts` / `test/handlers.test.ts` は
`expect(code).toContain('let count = 0;')` のような部分文字列アサーション
のみで、出力全体の形は何も固定していない。`test/build.test.ts:49-70` に
`spawnSync('bun', ['scripts/build.ts', fixturePath])` で実ビルドを回し
`dist/` を読む既存の手本がある。bun のテストランナーは `toMatchSnapshot()`
と `--update-snapshots` をサポートする。

## Goals / Non-Goals

**Goals:**
- 既存の代表フィクスチャ2つ(M1: signal+derived counter、M2: onClick
  ハンドラ付き counter)の生成コード・初期 HTML をスナップショットとして
  固定する。
- `compile()` の決定論(同一入力→同一出力)をテストとして固定する。
- 手書き基準との比較によるサイズ予算をテストとして固定する。

**Non-Goals:**
- 生成コードの改善・codegen 側の変更(このスイートは観測専用、`src/**`
  は一切触らない)。
- TodoMVC フィクスチャのサイズ比較(`examples/todomvc.handwritten.js` は
  M5 着地後の別の変更で追加する)。
- サイズ予算係数の最終確定(M6 で締める前提の暫定値)。

## Decisions

### 1. スナップショット対象は既存2フィクスチャのみ、新規 import 依存を作らない

`test/golden.test.ts` 内にフィクスチャ定数を直接持つ(`test/counter.test.ts`
/ `test/handlers.test.ts` からのコピー)。既存テストファイルへの import
依存を作ると、既存テストの変更がこのスイートを無関係に壊す経路になる。

### 2. サイズ予算の分母は新規の手書き基準ファイル

`examples/counter.jsx` と同じ UI を、経験豊富な開発者が hydrate 前提で
書いた場合のコードとして `examples/counter.handwritten.js` に新規作成する。
焼き込み済み HTML(`<div id="app">` 配下)を前提に、要素取得 +
`addEventListener` + 更新関数のみを書く素の ESM。恣意的に切り詰めない
普通の手書きコードとする ― サイズ予算はここを分母に使うため、分母自体を
歪めると予算の意味がなくなる。

### 3. 予算係数は3倍から開始する

現状 `dist/app.js` は minify なしで 995B(`ROADMAP.md` の実測)。手書き想定
400–600B に対し3倍という緩い係数で開始し、M4/M5 で生成物が育つ余地を
残す。実測比は `console.log` で出力し、退行の兆候を早期に可視化する。
係数を締めるのは M6(no-wrapper 横断検証)の仕事。

### 4. スナップショットが落ちた場合の運用規則をテストファイル冒頭に明記する

意図した codegen 変更なら `--update-snapshots` で更新し diff をレビューに
含める、意図していないなら退行 ― という運用規則をコードコメントとして
残す。無言の `--update-snapshots` 実行を防ぐのが目的(このテストスイート
自体の存在意義)。

## Risks / Trade-offs

- [スナップショットの更新が形骸化し、diff を見ずに機械的に
  `--update-snapshots` される] → テストファイル冒頭のコメントで運用規則を
  明記する。運用の強制はコードではできないため、レビュー側の注意事項として
  `plans`/`STATUS.md` 相当の場所にも残す。
- [サイズ予算係数(3倍)が緩すぎて実質チェックにならない] → 実測比を
  `console.log` で出力し、M6 で締める作業の入力にする。今回は許容
  (M4/M5 の破壊的な出力肥大さえ検出できれば十分)。
- [`compile()` が実は非決定的だった場合、この変更の前提が崩れる] →
  決定論テストを独立ケースとして先に置き、落ちたら `src/` の修正はこの
  変更のスコープ外として報告する(観測専用の原則を守る)。

## Migration Plan

新規テストファイルの追加のみ。既存コード・既存テストへの変更はない。
`bun test test/golden.test.ts` でスナップショットが初回生成され、以後
`bun run check-all` に含まれて毎コミット検証される。ロールバックは
`test/golden.test.ts` と `test/__snapshots__/golden.test.ts.snap` の削除のみ。

## Open Questions

- TodoMVC フィクスチャのサイズ比較をいつ追加するか(M5 着地後、別の変更に
  委ねる)。
