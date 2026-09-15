# Chunks

C1 [R1,K1,K2,A1] -> Monaco入力欄が既存の遅延読込みとTypeScript作業スレッドを使い、TypeScript/TSXモデルとして型注釈、型別名、interface、ジェネリクス、JavaScriptのキーワード・コメント・文字列、JSXタグ・属性・式を構文ハイライトする。
  boundary: `app/web/src/playground/monaco-editor.js` の言語モデル・字句定義・既存設定と、初期TSXソースを使う実ブラウザー試験だけを扱う。補完、型検査、意味解析、診断、型消去、実行経路は扱わない。

C2 [R2,R3,R4,R5,K3,K4,A2,A3,A4] <- C1 -> Monaco編集、公式例の切替え、共有ページからの複製によるソース置換後もTSXハイライトと読取り専用状態を保ち、`textarea`との値同期、保存、管理鍵付き共有、書き出し、実行、Monaco読込み失敗時の入力欄退避を確認する。
  boundary: `app/web/src/playground/client.js` の既存値経路を必要な範囲だけ検証または修正し、`app/web/scripts/playground-e2e.test.mjs` で受入条件を確認する。型変換を実行経路へ追加せず、実行管理画面・Worker・結果iframeの送信元と権限制限、64 KiB制限、保存形式、コンパイラ版、実行管理プロトコルを変更しない。`bun run typecheck:web` と `bun run test:web:playground`を完了条件にする。
