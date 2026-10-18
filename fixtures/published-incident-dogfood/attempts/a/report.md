公開版irisout 0.3.7をnpmから取得し、3回の型検査・本番構築で実装した。第3回は型検査、本番構築、HTTP・ブラウザー自己検査が通った。要求単位の初期HTML、404、503と回復、検索の競合、同一文書の詳細遷移、解決更新、ID別メモ、監視の登録・解除、遷移後の古い検索応答の抑止を確認した。ブラウザー例外は0件。独立操作役の検査、keyによるDOM同一性、Tab順序は未確認。

停止した診断は `compile: only top-level `signal()`/`derived()` declarations are supported in this milestone (scope limit)`。描画前の通常constオブジェクトをsignalへ変えて通過した。この制限の説明と診断位置は文書不足に分類した。最小再現はrepro/へ保存した。内部の監視関数をconstの矢印関数にする公開版向けの注意書きは役立った。

Python不在のまま第2回を起動した点は作業の誤り。SSR見出しの出現直後に監視数を検査した失敗は検査の誤り。DNS、listen、Chromiumの権限制約は昇格で解消した。本体の不具合と断定した項目はない。

`DOGFOOD_PORT=4317 bun run serve`で本番構築物をローカル配信する。取得先、版、梱包物のSHA-256/SHA-512はlog.mdに記録した。workspaceや本体の梱包物は使っていない。
