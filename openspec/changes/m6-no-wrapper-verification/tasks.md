# m6-no-wrapper-verification tasks

## 1. テスト実装

- [x] 1.1 `test/no-wrapper.test.ts`: 全機能フィクスチャ(signal / derived /
  静的属性 / inline・識別子参照ハンドラ / イベント引数 / リスト+ネスト
  条件分岐 / 条件分岐 / `use=`+クロージャ)を作成し、コンパイルが通ること
- [x] 1.2 no-wrapper 検証: `code` に `signal(`・`derived(` が現れない
  (design D2)
- [x] 1.3 import 面検証: import 文が `mount`/`hydrate` の1行のみ(design D2)
- [x] 1.4 実 DOM 動作検証: mount 後、イベント発火でテキスト・リスト・
  条件分岐・action クロージャが横断的に更新される(design D3)

## 2. 仕上げ

- [x] 2.1 `bun run check-all`(biome / typecheck / 全テスト green、既存
  スナップショット不変)
- [x] 2.2 `STATUS.md`: M6 を DONE に更新
