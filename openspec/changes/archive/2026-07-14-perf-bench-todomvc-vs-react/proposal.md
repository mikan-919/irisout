## Why

M5(list/conditional factory closures)の設計は、ADR-0005で「keyed reuseのMapは
Reactの Fiber 帳簿と同種のコストである」という見立てに基づいている。この見立てを
実測で検証しないまま M5 の実装に進むと、コンパイラ完成後に「そもそも React に
性能で勝てない」ことが判明するリスクを後倒しにするだけになる。`examples/todomvc.
handwritten.js` は irisout の生成出力が到達しうる性能の上限値(コンパイラが将来
出力するコードより悪くなることはない基準)として既に用意されており、これを
React版TodoMVCと比較する形で今のうちに決着させる。

## What Changes

- `examples/todomvc.handwritten.js`(irisoutのkeyed reuseパターンを手書きで
  適用したTodoMVC実装)と、同等機能のReact版TodoMVC実装を用意する。
- 両実装に対して同一シナリオ(初期描画・大量アイテム追加・フィルタ切り替え・
  完了トグル・アイテム削除など)を走らせるベンチマークハーネスを作成する。
- 計測結果(処理時間・メモリ etc.)を`bench/`配下にレポートとして残し、
  ADR-0005の見立てが妥当かどうかの結論を記録する。
- 本changeはコンパイラ本体(`src/`)には手を入れない。計測専用。

## Capabilities

### New Capabilities
- `todomvc-perf-benchmark`: handwritten TodoMVC実装とReact版TodoMVC実装を
  同一シナリオで比較計測するベンチマークハーネスとレポート。

### Modified Capabilities
(なし)

## Impact

- 影響範囲: `bench/`(新規ベンチマークスクリプト)、`examples/`(React版
  TodoMVCの追加、必要なら手書き版の計測用フック追加)。
- `src/`(コンパイラ本体)・既存specsへの影響なし。
- 依存追加: React版実装のためReact(および付随するReact DOM)を
  devDependencyとして追加する可能性がある。
- 結果はROADMAP.mdの「次のアクション」5(M5設計)の判断材料として使う。
