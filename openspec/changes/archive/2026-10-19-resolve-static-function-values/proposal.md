# 関数値の静的解決

関数のconst別名、引数経由の呼出し、変数へ保存した後始末の返却、生成予約名との衝突を理由とする拒否を縮める。呼出先を一つの本体へ解決できる形を既存の関数本体変換へ渡し、通常のJavaScriptの評価順序・宣言前参照・例外・閉包を保つ。実行時の汎用関数表と購読機構は追加しない。

対象仕様は`cross-function-handler-writes`、`element-use-action`、`on-mount-lifecycle`、`effect-lifecycle`、`handler-statement-bodies`、`server-rendering-entry`。設計判断はADR-0071。公開版0.3.7の観測記録と未公開のソース変更を分ける。
