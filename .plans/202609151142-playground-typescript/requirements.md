# Goal

PlaygroundのMonaco EditorをTypeScript/TSX入力として扱い、TypeScript構文とJSX構文を色分けして表示する。

# Terms

D1 TypeScript/TSX入力: Monacoの入力モデルをTypeScriptの言語定義で扱い、TypeScriptの型注釈・型別名・interface・ジェネリクスとJSXを含む一つのソースを表示できる状態。

D2 構文ハイライト: Monacoの字句解析によるキーワード、型関連の語、コメント、文字列、JSXタグ、JSX属性、JSX式の色分け。補完、型検査、意味解析、診断は含まない。

D3 入力値: 既存の`[data-playground-source]`の`textarea`と、読込み成功時に表示される`[data-playground-monaco]`の編集値。同じソース文字列を保存、書き出し、実行へ渡す。

# Req

R1 Monaco入力欄は、初期ソースをTypeScript/TSXの言語定義で表示し、TypeScriptの型構文とJavaScriptのキーワード・コメント・文字列、JSXタグ・属性・式を構文要素として色分けする。

R2 Monaco上の編集、公式例の切替え、共有ページからの複製でソースが置き換わっても、TSXの言語定義と構文ハイライトを維持する。

R3 Monacoの編集値と既存`textarea`の値を同期し、保存、管理鍵付きの共有、書き出し、実行は既存と同じ入力値を参照する。

R4 Monaco本体または言語機能の遅延読込みに失敗した場合、入力値を失わず既存`textarea`を表示し、入力、保存、書き出しを継続できる。

R5 TypeScript/TSXの表示対応後も、投稿ソースを公式サイトのサーバーで変換・実行しないこと、実行管理画面・Worker・結果iframeの送信元と権限制限を変更しないこと。

# Constraints

K1 既存の`monaco-editor` 0.56.0、遅延読込み、TypeScript作業スレッドを使い、構文強調表示のための依存を追加しない。

K2 言語機能は構文ハイライトに限り、現在の意味検査を無効にした設定、テーマ、読取り専用状態、アクセシビリティ属性を保つ。

K3 入力は単一ソース文字列、既存の64 KiB制限、既存の保存形式、コンパイラ版、実行管理プロトコルを保つ。複数ファイル、npm依存、利用者が選ぶ言語は追加しない。

K4 TypeScript固有構文の型消去や変換を実行経路へ追加しない。既存コンパイラが受理する範囲の実行だけを保ち、型構文の実行対応は別の変更とする。

# Non-goals

N1 TypeScriptの型検査、補完、ホバー、定義移動、整形、リンター、診断表示。

N2 TypeScript構文をブラウザー実行用JavaScriptへ変換するコンパイラ機能、実行Workerの変更、サーバー側の保存・SSR契約の変更。

N3 公式例、文書生成側のコード表示、既存の`.jsx`入力契約を`.tsx`ファイル契約へ変更すること。

# Done

A1 [R1,K1,K2] ChromiumでPlaygroundを開くと、型注釈・型別名またはinterface・ジェネリクスを含むTSXソースのTypeScript構文と、コメント・文字列・JSXタグ・属性・式が通常のJSX本文と異なる構文色で表示される。

A2 [R2,R3,K2] 初期表示、Monaco編集、公式例切替え、共有複製の各経路で表示ソースと`textarea`値が一致し、置換後もTSXハイライト、読取り専用状態、保存、書き出し、実行が成立する。

A3 [R4,K3] Monaco資産を読み込めない試験で`textarea`が表示され、初期値・複製値・利用者入力を失わず、既存の入力・保存・書き出し経路を使える。

A4 [R5,K3,K4] 既存の実行隔離・送信元検査・保存共有試験が変わらず成功し、`bun run typecheck:web`と`bun run test:web:playground`が成功する。
