# scope-limit-coverage tasks

## 1. 構文検査の追加

- [x] 1.1 `src/compiler/render.ts` `processDeclarationStatement`: 宣言子 id が
  `Identifier` でなければ scope limit エラー(design D1)
- [x] 1.2 `src/compiler.ts`: Program 直下の文を検証し、関数宣言
  (`ExportNamedDeclaration` ラップ込み)以外を scope limit エラーで拒否
  (design D2)
- [x] 1.3 `src/compiler.ts`: ビルド時実行を try/catch し
  `compile: build-time execution failed: ...`(`cause` 付き)で再 throw
  (design D3)

## 2. テスト

- [x] 2.1 `const [a] = signal(0)` が `compile:`+`(scope limit)` で拒否される
- [x] 2.2 コンポーネント外 `const TAX = 1.1` が同様に拒否される
- [x] 2.3 ビルド時実行で throw するソースのエラーが `compile:` で始まり
  `cause` を持つ
- [x] 2.4 既存フィクスチャ(counter / todomvc)が引き続きコンパイルできる
  こと(`bun run check-all` で全テスト green)

## 3. ドキュメント

- [x] 3.1 `STATUS.md`: 既知の制約に「トップレベルは関数宣言のみ」の明示を
  追記
