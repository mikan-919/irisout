## 1. render() マーカーの認識

- [x] 1.1 `compileComponent`(`src/compiler/render.ts`)の走査を「render前 / render / render後」の3段に分ける
- [x] 1.2 `render()` 呼び出し文を特定し、第1引数のJSX要素からHTMLソースを生成(既存 `renderElement` を流用)
- [x] 1.3 `render()` が0個 / 2個以上 の場合の scope limit を追加
- [x] 1.4 `return <JSX>` を検出したら scope limit で拒否(単一return前提の削除)
- [x] 1.5 `src/compiler.ts` のビルド時実行組み立てを `render()` 由来の `rootHtmlSource` に合わせて調整(`return` 文依存の除去)

## 2. ゾーン配置規則の強制

- [x] 2.1 render前の文: `signal()`/`derived()` const宣言のみ許可、function宣言は scope limit
- [x] 2.2 render後の文: function宣言のみ許可、const宣言・その他の文は scope limit
- [x] 2.3 エラー書式を `docs/conventions.md` 準拠(`compile:` 始まり・`(scope limit)` 末尾)に統一

## 3. 識別子参照ハンドラの解決

- [x] 3.1 render後方の function宣言を name→node の表に収集
- [x] 3.2 `collectAttrs` のハンドラ分岐に「値が `Identifier`」の場合を追加し、表から参照先を解決
- [x] 3.3 参照先 function宣言の本体を単一 `ExpressionStatement` に限定し、その式を `analyzeHandlerExpr` へ渡す
- [x] 3.4 参照先が見つからない / 変数ゾーンのarrow参照 / 本体が複数文 → scope limit
- [x] 3.5 inline arrow ハンドラの既存経路が引き続き通ることを確認

## 4. フィクスチャ移行

- [x] 4.1 `examples/counter.jsx` を `render()` + ハンドラfunction宣言化へ移行
- [x] 4.2 その他の `examples/*.jsx`(ゾーン化対象のもの)を移行
- [x] 4.3 golden-output スナップショット / handwritten 期待出力を移行後の authoring に合わせて更新(生成 `code`/`initialHtml` は不変を確認)

## 5. テスト

- [x] 5.1 `render()` でUI宣言 → 生成成功、`loadGenerated()` で実行して挙動確認
- [x] 5.2 識別子参照ハンドラ(後方function宣言)→ 書き込み配線が生成されることを確認
- [x] 5.3 新 scope limit を踏むテスト: return拒否 / render欠如 / render前function / render後const / 変数ゾーンarrow参照 / 複数文本体
- [x] 5.4 inline arrow ハンドラの回帰テスト

## 6. ドキュメント

- [x] 6.1 `STATUS.md` のマイルストーン表を更新(M4.5 を DONE に、commit 追記)
- [x] 6.2 `ROADMAP.md` の「次のアクション」を更新(M4.5 完了 → 次は M5)
- [x] 6.3 ADR-0008 のステータスを「実装済み」に更新
- [x] 6.4 `bun run check-all` が通ることを確認
