# loud-hydration-mismatch tasks

## 1. ランタイム検証

- [x] 1.1 `src/runtime.ts`: `mount(container, html, expectedIds?)` /
  `hydrate(container, expectedIds?)` に拡張し、欠落 ID 列挙エラーを throw
  (design D1、引数省略時は検証スキップ)

## 2. codegen

- [x] 2.1 `src/codegen.ts`: トップレベルマーカー ID +ハンドラ markerId の
  全リストを `__MARKER_IDS__` として出力し、mount/hydrate 呼び出しへ渡す

## 3. テスト

- [x] 3.1 改変済み DOM(マーカー要素を削除)への `hydrateComponent()` が
  欠落 ID を含むエラーで throw する
- [x] 3.2 正常な mount/hydrate は従来どおり動作する(既存テストが green)
- [x] 3.3 golden スナップショット更新(mount/hydrate 行 + `__MARKER_IDS__`
  のみの diff であること・サイズ予算 3x 内を確認)
- [x] 3.4 `bun run check-all`
