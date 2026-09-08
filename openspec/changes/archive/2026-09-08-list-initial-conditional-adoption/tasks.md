## compiler

- [x] 安全な初期枝だけを項目templateへ埋め込む判定を追加する。
- [x] 初回専用フラグと既存DOM引き取りを生成し、空枝再表示での誤引き取りを防ぐ。
- [x] SVG親要素、lifecycle、入れ子構造、異なる初期値を従来経路へ戻す。
- [x] 最適化対象外のconditional挿入出力を従来形へ戻す。

## tests

- [x] mount/hydrate、初期true/false、空枝の非表示往復を実DOMで確認する。
- [x] keyed追加、並べ替え、削除、イベント、状態保持を実DOMで確認する。
- [x] lifecycle、入れ子構造、SVG自身、SVG親要素、リスト外条件を対象外として確認する。

## documentation and verification

- [x] ADR-0045、canonical OpenSpec、性能結果、STATUSを更新する。
- [x] 変更前コミットと最終実装を同一Chromium・入力・反復数で比較する。
- [x] check、全試験、build、package build、pack smoke、R2ブラウザ試験を実行する。
- [x] 20%未達と測定ばらつき、転送量・ヒープ・通常更新の差を記録する。
