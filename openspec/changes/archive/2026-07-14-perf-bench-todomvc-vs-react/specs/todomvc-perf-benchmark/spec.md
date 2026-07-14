## ADDED Requirements

### Requirement: handwritten版とReact版の同一シナリオ計測
ベンチマークハーネスは、`examples/todomvc.handwritten.js`とReact版TodoMVC
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
できる形で記録しなければならない(SHALL)。

#### Scenario: N=100,000での計測
- **WHEN** ベンチマークをN=100,000で実行する
- **THEN** handwritten版・React版双方の処理時間が記録され、既存Nに対する
  相対的な伸び率が算出できる

### Requirement: 計測結果のレポート出力
ベンチマークハーネスは、実行結果を`bench/`配下に人間が読めるレポートとして
残さなければならない(SHALL)。レポートにはADR-0005の見立て
(keyed reuseのMapの帳簿コストはReact Fiberと同種)に対する結論を含める。

#### Scenario: レポートへの結論記載
- **WHEN** 全シナリオ・全Nの計測が完了する
- **THEN** `bench/`配下のレポートに、各シナリオでのhandwritten版とReact版の
  比較結果、およびADR-0005見立てへの結論(裏付けられた/反証された)が
  記載される
