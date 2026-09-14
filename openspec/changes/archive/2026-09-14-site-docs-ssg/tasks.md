## 1. 入力と解析

- [x] 1.1 文書メタデータと8分類を登録し、重複slug・順序重複がビルドエラーになることを確認する
- [x] 1.2 `docs/getting-started.md`を正本として読み込み、本文の複製なしにHTMLを生成できることを確認する
- [x] 1.3 任意HTML、未知のコード言語、相対・絶対の切れた文書・見出し・画像・例参照、path traversal、不正なpercent encodingを検査して失敗することを確認する

## 2. HTMLと索引

- [x] 2.1 文書一覧・詳細、目次、前後リンク、正規URLを生成し、JavaScriptなしの直接URLで読めることを確認する
- [x] 2.2 タイトルと見出しの検索索引を生成し、文書ページがMarkdown解析器を読み込まないことを依存一覧で確認する
- [x] 2.3 Counter・List・SVGの表示用コードと後続Playground接続用`examples.json`を同じ例入力から生成し、`irisout@0.2.2`で検査できることを確認する。Playground画面の読込みは後続changeで接続する

## 3. 検査接続

- [x] 3.1 `build:web`とサイト検査をCIの実行入口へ追加し、`bun run build:web`が成功することを確認する
- [x] 3.2 `bun run check`、`bun run test`、`bun run build:web`とOpenSpec検証が成功することを確認する
