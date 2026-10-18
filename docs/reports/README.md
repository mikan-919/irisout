# 検証報告

- [修正文書によるnpm公開版の試用B](./2026-10-18-published-incident-dogfood-v2.md): A・Bとも実装3回。Bは既存7/8と追加8/8を分け、同名props/signalのSSRとonError後の経路検出を公開版の課題として記録した。
- [npm公開版による障害対応ボードの試用A](./2026-10-18-published-incident-dogfood-v1.md): 公開版0.3.7で実装3回と独立操作16項目を実行し、状態宣言とBun本番配信の文書不足を修正した。
- [初期化関数の制御フロー](./2026-10-09-lifecycle-control-flow.md): use・onMount・effectの分岐返却、局所変数参照、終了時の状態反映と後始末の所有を検証した。
- [拒否条件の整理](./2026-10-08-constraint-inventory.md): 拒否箇所を共通原因39群へ分け、通常のJavaScriptへの制限と設計上の境界を区別した。
- [障害対応ボード v1](./2026-10-08-incident-dogfood-v1.md): 公開文書だけの開発者役と、ソースを見ない操作役。構築入口、API接続、監視関数、契約の説明不足を記録した。
- [障害対応ボード v2](./2026-10-08-incident-dogfood-v2.md): 修正文書から新しい開発者役が実装し、同じ8項目を追試した。合格後に見つけた表示の矛盾も記録した。
- [検証ログの試用](./2026-10-08-verification-log-dogfooding-v1.md): 保存・検索・編集・状態切替を画面から確認した。
- [ヒートマップの解析結果無効化](./2026-10-08-heatmap-analysis-invalidation-v1.md): 上限超過後の古い解析結果を消す修正とブラウザー計測。
