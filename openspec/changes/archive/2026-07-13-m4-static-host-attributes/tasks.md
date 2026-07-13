## 1. 属性走査の分岐

- [x] 1.1 `src/compiler/render.ts` の `collectHandlerAttrs` を
      `collectAttrs` に改名し、戻り値を `{ handlerAttrs, staticAttrs }`
      に拡張する。既存のハンドラ処理(scope limit・引数拒否・ブロック
      本体拒否含む)はそのまま維持する。
- [x] 1.2 ハンドラ以外の属性のうち、属性名が `JSXIdentifier` かつ値が
      `StringLiteral` または `null`(valueless)のものを静的属性として
      `staticAttrs` へ積む。型は `{ name: string, value: string } | { name: string, valueless: true }`
      のように文字列値と valueless を区別できる形にする(design.md 決定4)。
- [x] 1.3 上記に当てはまらない属性(値が `JSXExpressionContainer`、
      `JSXNamespacedName`、spread)は既存の
      `compile: host element attributes are not supported yet (scope limit)`
      で拒否し続ける。式の中身を評価・解析しない(定数式でも拒否)。
- [x] 1.4 `renderElement` の呼び出し元を `collectAttrs` の新しい戻り値に
      合わせて更新する。

## 2. テンプレートへの反映

- [x] 2.1 `src/template.ts` に `renderStaticAttrs(attrs): string` を追加し、
      既存の `escapeAttrValue` を使って ` name="value"` / ` name`
      (valueless)を連結した文字列を返す。
- [x] 2.2 `renderElement`(`src/compiler/render.ts`)の開始タグ組み立てを
      `<${tagName}${renderStaticAttrs(staticAttrs)}${markerPart}>` の形に
      変更する。`data-iris-id` 付き・なし双方の既存パターン(ハンドラのみ・
      reactive text マーカー・どちらもなし)全てで静的属性が正しく差し込まれる
      ことを確認する。

## 3. テスト

- [x] 3.1 `test/` に静的属性のコンパイル・生成 HTML を検証するテストを
      追加する(`specs/static-host-attributes/spec.md` の各 Scenario に
      対応):単一の文字列属性、複数の文字列属性、属性値のエスケープ、
      値なし真偽属性、式コンテナ値の拒否(signal 依存あり/なし両方)、
      spread 属性の拒否、ハンドラ属性との共存。
- [x] 3.2 `loadGenerated` で生成コードを実際に import して実行し、
      静的属性がハンドラの動作(例: クリックでの状態更新)を妨げないことを
      挙動として検証する(文字列マッチだけで済ませない、conventions.md)。

## 4. 既存フィクスチャでの確認

- [x] 4.1 `examples/counter.jsx`(`<button type='button'>`)を `compile()`
      に通し、compile error が出ずに `type="button"` を含む HTML が
      生成されることを確認する。
- [x] 4.2 `examples/todomvc.jsx` の静的 `class` 属性(`todoapp` /
      `todo-list` / `filters` 等、動的な `class={todo.completed ? ... }`
      を除く)を `compile()` に通し、該当箇所で compile error が出ないことを
      確認する。動的 class(`UNRESOLVED(02)`)は引き続き拒否されることを
      合わせて確認する。

## 5. 仕上げ

- [x] 5.1 `bun run check-all`(biome check --write → tsc --noEmit → bun test)
      を実行し、全て通過することを確認する。
- [x] 5.2 `STATUS.md` のマイルストーン表の M4 を `DONE` に更新し、実装コミット
      ハッシュを備考に記録する。
- [x] 5.3 `ROADMAP.md` の「次のアクション」を更新し、次のステップが
      API 変更(ADR-0008)であることを明記する(M4 完了を反映)。
