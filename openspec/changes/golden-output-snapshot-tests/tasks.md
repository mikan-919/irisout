## 1. スナップショットテスト

- [ ] 1.1 `test/golden.test.ts` を新規作成し、冒頭コメント(日本語)に
      スナップショット更新の運用規則(意図した変更なら
      `--update-snapshots` + diff レビュー、意図しないなら退行)を明記する。
- [ ] 1.2 M1 フィクスチャ(`test/counter.test.ts` の `COUNTER_SOURCE` を
      コピーした定数)の `compile(...).code` と `initialHtml` を
      `toMatchSnapshot()` で固定する。
- [ ] 1.3 M2 フィクスチャ(`test/handlers.test.ts` の `COUNTER_SOURCE` を
      コピーした定数)の `compile(...).code` を `toMatchSnapshot()` で
      固定する。
- [ ] 1.4 同一ソースを2回 `compile()` し、`expect(a.code).toBe(b.code)` で
      決定論を検証するケースを追加する。

## 2. 手書き基準とサイズ予算

- [ ] 2.1 `examples/counter.handwritten.js` を新規作成する(焼き込み済み
      HTML 前提、要素取得 + `addEventListener` + 更新関数のみの素の ESM、
      import なし)。
- [ ] 2.2 `test/golden.test.ts` に、`spawnSync('bun', ['scripts/build.ts',
      'examples/counter.jsx'])` で `dist/app.js` を生成し、そのバイト
      サイズを手書き基準ファイル(コメント行・空行を除いた byteLength)の
      3倍以内に収まることを検証するケースを追加する。実測比を
      `console.log` で出力する。

## 3. 回帰チェック

- [ ] 3.1 記録済みスナップショット文字列に `signal(` / `derived(` が
      含まれないことを検証するケースを追加する(ADR-0006 の回帰チェック)。

## 4. 仕上げ

- [ ] 4.1 `bun test test/golden.test.ts` を実行し、初回でスナップショットが
      生成され全ケースがパスすることを確認する。もう一度実行して安定
      (flaky でない)ことを確認する。
- [ ] 4.2 `bun run check-all` を実行し、全体が通過することを確認する。
- [ ] 4.3 `git status` で in-scope 外のファイル(`src/**` を含む)に変更が
      ないことを確認する。
