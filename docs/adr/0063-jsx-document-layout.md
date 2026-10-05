# JSXで文書を所有するLayout

`createFileRouter()`の文字列を返す`document`関数では文書構造とページ部品の記述が分かれるため、`Layout`が`return <html>`で文書を宣言できるようにする。`render(<JSX>)`も維持し、返却記法ではハンドラ関数とライフサイクル処理を返却前へ置く。部品合成後のルートが`html`なら文書と判定し、`head`、`body`の順序を検査する。ルーターは状態と起動scriptだけをbody末尾へ加える。

文書ページはhtml要素をhydrateし、文書間遷移ではDOMParserでhtml属性とhead/bodyを更新する。DOMParserのscriptは実行されないため、独自の実行可能scriptを含む文書への遷移はブラウザーへ委ねる。scriptの実行順を再実装する案は採用しない。既存の`document`指定は互換性のため優先する。
