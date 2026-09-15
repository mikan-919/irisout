# Chunks

C1 [R1,K1,K2,A1] -> Monaco入力欄が、既存の遅延読込みと作業スレッド設定を使い、JavaScript/JSXのキーワード、文字列、コメント、JSXタグ、JSX属性を構文ハイライトする。
boundary: `app/web/src/playground/monaco-editor.js` の言語定義とモデル設定、初期表示の実ブラウザー試験だけを扱う。補完、意味解析、診断、TypeScript固有機能は扱わない。

C2 [R2,R3,R4,R5,K3,A2,A3,A4] <- C1 -> ソース置換、Monaco上の編集、例の切替え、共有値の複製で構文ハイライトを維持し、既存のtextarea同期、読取り専用状態、保存、書き出し、実行、読込み失敗時の退避を確認する。
boundary: `app/web/src/playground/client.js` の値経路を必要な範囲だけ検証または修正し、投稿ソースの変換・実行管理画面・別配信元の境界は変更しない。`bun run typecheck:web` と `bun run test:web:playground`を完了条件にする。
