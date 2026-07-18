# loud-hydration-mismatch

## Why

生成コードはマーカー欠落を黙って無視する — ハンドラ配線は
`__markers__.get(id)?.addEventListener`、`update_*` は `if (__el)` ガードで
no-op になる(`src/codegen.ts`)。DOM と生成コードの不一致(初期 HTML の
改変・別コンテナへの hydrate 等)が起きると、イベントも更新も**静かに**
効かなくなる。「黙って握りつぶさず必ずエラーにする」という自身の規約
(docs/conventions.md)のランタイム側の穴。

## What Changes

- mount/hydrate 時に、生成コードが必要とする全マーカー ID の存在を1回
  検証し、欠落があれば欠落 ID を列挙するエラーを throw する。
- 検証ロジックはランタイム(`src/runtime.ts`)側に置き、生成コードは期待
  ID のリストを渡すだけにする(出力の膨張を最小化 — ADR-0004)。
- 既存の `?.` / `if (__el)` ガードは出力形を変えないためそのまま残す
  (mount 時検証が通れば実質デッドガード)。

## Capabilities

### New Capabilities

- `hydration-marker-verification`: mount/hydrate 時のマーカー存在検証と、
  欠落時の明示的エラー。

### Modified Capabilities

- `generated-output-regression-tests`: サイズ予算係数を 3x → 4x へ変更
  (ランタイム検証コードの固定費増。2026-07-18 実装時判断)。

## Impact

- `src/runtime.ts`: `mount()`/`hydrate()` に期待マーカー ID の検証を追加。
- `src/codegen.ts`: `mount(container, __INITIAL_HTML__)` /
  `hydrate(container)` 呼び出しに期待 ID 配列を渡す。
- `test/`: 欠落マーカーで throw するテスト、既存テストのシグネチャ追随。
- golden スナップショット: mount/hydrate 呼び出し行のみ変化(想定内)。
