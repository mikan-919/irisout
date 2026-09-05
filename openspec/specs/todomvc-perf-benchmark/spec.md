# todomvc-perf-benchmark

## Purpose

ADR-0005(keyed reuseのMapの帳簿コストはReact Fiberと同種)という見立てを、
`apps/examples/todomvc.handwritten.js`(M5 codegenの目標出力の上限値)と同等機能の
React版TodoMVCの実測比較で検証する(change `perf-bench-todomvc-vs-react`)。
結果は`packages/bench/todomvc-vs-react.results.md`にまとめ、M5.5以降の設計
判断材料とする。本capabilityはベンチマークハーネス・レポートのみを対象とし、
コンパイラ本体(`packages/compiler/`)は対象外。

## Requirements

### Requirement: handwritten版とReact版の同一シナリオ計測
ベンチマークハーネスは、`apps/examples/todomvc.handwritten.js`とReact版TodoMVC
実装に対して、同一の操作シナリオ(初期マウント・全アイテム完了トグル・
フィルタ切り替え・アイテム追加・アイテム削除)を同じデータサイズNで実行し、
両者の処理時間を計測しなければならない(SHALL)。

#### Scenario: 同一Nでの初期マウント計測
- **WHEN** ベンチマークをN件のTodoアイテムで実行する
- **THEN** handwritten版・React版それぞれの初期マウント処理時間が
  ミリ秒単位で記録される

#### Scenario: keyed reuseによるアイテム追加時の既存要素保持確認
- **WHEN** N件マウント済みの状態に1件アイテムを追加する
- **THEN** handwritten版は既存N件のDOM要素・イベントリスナーを再生成せず、
  追加分のみを生成する

### Requirement: 複数データサイズでのスケーラビリティ計測
ベンチマークハーネスは、N=100/1,000/10,000/100,000の複数サイズで計測を
実行し、Nの増加に対する処理時間の伸び方をhandwritten版とReact版で比較
できる形で記録しなければならない(SHALL)。完了トグルシナリオのように
1回の更新でO(N)かかる操作をN回繰り返す場合はO(N^2)になり、現実的な時間で
終わらないデータサイズは計測対象から除外し、実測値からの外挿で扱ってよい。

#### Scenario: N=100,000での計測
- **WHEN** ベンチマークをN=100,000で実行する
- **THEN** handwritten版・React版双方の処理時間が記録され、既存Nに対する
  相対的な伸び率が算出できる

#### Scenario: O(N^2)シナリオの大サイズ除外
- **WHEN** あるシナリオの1回あたりの計測がO(N)×N回でO(N^2)になり、
  N=10,000以上で現実的な時間(数十分以上)を要すると判明する
- **THEN** そのシナリオはより小さいNの実測値に留め、大きいNについては
  レポート内でO(N^2)を仮定した外挿値として明記する

### Requirement: 計測結果のレポート出力
ベンチマークハーネスは、実行結果を`packages/bench/`配下に人間が読めるレポートとして
残さなければならない(SHALL)。レポートにはADR-0005の見立て
(keyed reuseのMapの帳簿コストはReact Fiberと同種)に対する結論を含める。

#### Scenario: レポートへの結論記載
- **WHEN** 全シナリオ・全Nの計測が完了する
- **THEN** `packages/bench/`配下のレポートに、各シナリオでのhandwritten版とReact版の
  比較結果、およびADR-0005見立てへの結論(裏付けられた/反証された)が
  記載される
