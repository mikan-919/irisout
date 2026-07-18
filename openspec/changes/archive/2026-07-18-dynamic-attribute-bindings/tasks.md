# dynamic-attribute-bindings tasks

## 1. 共有基盤

- [x] 1.1 `docs/adr/0012-dynamic-attribute-bindings.md`(作成済みの確認)
- [x] 1.2 `src/template.ts`: `attrBindingKind(name)` 分類ヘルパー(design D1)
- [x] 1.3 `src/compiler/state.ts`: `AttrBinding` 型・`ctx.attrBindings`・
  `StructuralUnitBody.localAttrBindings`(design D2)

## 2. render

- [x] 2.1 `collectAttrs`: 式コンテナ値を動的属性として収集(第4分類)
- [x] 2.2 `renderElement`: marker id 相乗り・トップレベルのみ焼き込み
  (design D3)・deps の markerDeps 合流
- [x] 2.3 soleKind 分岐: ハンドラの unit marker id への配線(silent drop
  修正、design D5)+動的属性の相乗り
- [x] 2.4 `renderStructuralUnitBody`: attrBindings の splice と追跡 signal
  参照の scope limit

## 3. compiler / codegen

- [x] 3.1 `src/compiler.ts`: `__escAttr__` 注入・attrBindings の codegen
  受け渡し(convertBody の localAttrBindings 含む)
- [x] 3.2 `src/codegen.ts`: `update_<name>()` の属性設定行(属性のみ marker
  対応込み)・`generateFactory` の設定行(design D4)

## 4. テスト・仕上げ

- [x] 4.1 `test/dynamic-attrs.test.ts`: 初期焼き込み(class/checked
  presence/エスケープ)・update 反映(setAttribute/プロパティ)・リスト
  アイテム追随・scope limit・no-wrapper
- [x] 4.2 ユニットホスト要素の onClick 配線テスト
- [x] 4.3 `examples/todomvc.jsx`: UNRESOLVED(02)/(03) コメント解消
- [x] 4.4 `bun run check-all` green・既存スナップショット不変の確認
- [x] 4.5 `STATUS.md`(制約一覧の更新)・`ROADMAP.md`(項目8完了)
