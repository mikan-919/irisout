# escape-initial-html tasks

## 1. エスケープの実装

- [x] 1.1 `src/compiler/render.ts` `buildTextMarker`: `sourceParts` に積む式
  コードを `__esc__(<sourceRendered>)` で包む(design D1)
- [x] 1.2 `src/compiler.ts`: `new Function('signal', 'derived', '__esc__', body)`
  に変更し、`&`/`<` をエンティティ化するエスケープ関数を渡す(design D2)

## 2. テスト

- [x] 2.1 注入フィクスチャのテスト追加: `signal("<img src=x onerror=alert(1)>")`
  で `initialHtml` に `<img` タグが現れず `&lt;` にエスケープされること
- [x] 2.2 `signal("a & b")` で `initialHtml` が `a &amp; b` になること
- [x] 2.3 ハイドレーション整合テスト: 特殊文字値で `mountComponent()` 後、
  `update_*()` を呼んでも `textContent` が変わらないこと(jsdom 実 DOM)
- [x] 2.4 `bun run check-all` — 既存 golden スナップショットが不変であること
  を確認(変化したら原因を調査)

## 3. ドキュメント

- [x] 3.1 `STATUS.md`: 既知の制約から本注入穴の記述を反映(計画外バグ発見と
  修正の記録)
