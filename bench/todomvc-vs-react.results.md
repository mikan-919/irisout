# todomvc-vs-react ベンチマーク結果

change: `perf-bench-todomvc-vs-react`。実行: `bun run bench/todomvc-vs-react.ts`
(要 `NODE_ENV=production` — react-dom を production ビルドで動かすため。
未指定でも動くがReact側のdev checkのぶん遅くなる)。

## 方法

- `examples/todomvc.handwritten.js`(ADR-0005 keyed reuse の手書き目標出力、
  M5 codegenの上限値)と `examples/todomvc.react.tsx`(標準的なkey付きReact
  実装、`useState`のみ・非最適化)を、同一シナリオ・同一Nでjsdom上に
  マウントして比較した。
- `bench/listener-strategy.ts`と同じ割り切り: jsdom上の相対比較であり、
  実ブラウザの絶対値ではない。
- Reactは`root.render()`・各イベントdispatchのたびに`flushSync`で
  同期コミットさせている。これをしないとReactの自動バッチングにより
  「1イベント = 1回の再描画」というhandwritten版と同じ条件にならず、
  Nイベントが1回のレンダーにまとめられてReact側が不当に有利になる。
- チェックボックス・ボタン操作は`el.click()`(ネイティブのactivation
  behavior)を使う。合成`dispatchEvent(new Event('change'))`だけでは
  jsdom上でchecked切り替えも後続のchangeイベント発火も起きないため。

### fixtureの修正

`examples/todomvc.handwritten.js`の`update_todos()`にあった除去判定
(`todos.some((t) => t.id === id)`)はO(N)走査をMapエントリ数ぶん繰り返す
O(N^2)実装で、実際の`src/codegen.ts`の`generateListUpdate()`が使う
`__seen__` Set方式(O(N))とずれていた古いバグだった。今回この
コミットで`__seen__` Setに揃えて修正した(挙動は変わらず、除去判定の
計算量のみO(N)に改善)。この修正がないとN=100,000での初期マウント
1回だけでも約10^10回の走査になり計測が現実的な時間で終わらない。

### toggleAllシナリオのみN=100/1,000に限定

「N件全アイテムの完了トグル(1件ずつ)」は、各トグルのたびに
`todos.map()`で配列を丸ごと複製して再描画する実装(handwritten・React
共通のパターン)のため、1回の更新がO(N)、それをN回行うのでO(N^2)になる。
これはimplementation固有のバグではなく、「不変配列 + 1件ずつのトグル」
というシナリオ自体が持つ性質(両実装とも同じ)。N=100→1,000の実測で
O(N^2)を確認したため、N=10,000/100,000は現実的な時間(数十分〜数十時間)
で終わらず計測対象から除外し、下記で外挿するに留めた。

## 結果: mount / filterSwitch / addOne / removeOne(N=100〜100,000)

| N | scenario | handwritten (ms) | react (ms) | react/handwritten |
|---|---|---|---|---|
| 100 | mount | 61.02 | 24.53 | 0.40x |
| 100 | filterSwitch | 10.65 | 4.32 | 0.41x |
| 100 | addOne | 9.77 | 21.37 | 2.19x |
| 100 | removeOne | 7.36 | 3.62 | 0.49x |
| 1,000 | mount | 112.42 | 48.31 | 0.43x |
| 1,000 | filterSwitch | 39.14 | 25.04 | 0.64x |
| 1,000 | addOne | 25.58 | 29.82 | 1.17x |
| 1,000 | removeOne | 45.76 | 14.46 | 0.32x |
| 10,000 | mount | 644.05 | 448.57 | 0.70x |
| 10,000 | filterSwitch | 416.36 | 295.82 | 0.71x |
| 10,000 | addOne | 267.21 | 235.36 | 0.88x |
| 10,000 | removeOne | 240.50 | 171.69 | 0.71x |
| 100,000 | mount | 7512.15 | 4620.44 | 0.62x |
| 100,000 | filterSwitch | 4479.84 | 3138.83 | 0.70x |
| 100,000 | addOne | 2721.88 | 3541.74 | 1.30x |
| 100,000 | removeOne | 2376.41 | 1270.21 | 0.53x |

(ratio = react ÷ handwritten。1.0未満はReactの方が速い。)

`addOne`では両実装とも既存要素(`<li>`のDOM参照)が再生成されず保持されて
いることを全Nで確認済み(`addOnePreservedExisting: true`)。

## 結果: toggleAll(N=100, 1,000のみ)

| N | handwritten (ms) | react (ms) | react/handwritten |
|---|---|---|---|
| 100 | 256.45 | 162.80 | 0.63x |
| 1,000 | 23,934.22 | 11,383.25 | 0.48x |

N=100→1,000(10倍)でhandwrittenは93.3倍、reactは69.9倍に増加しており、
いずれもO(N^2)的な伸びを裏付ける。この傾向をO(N^2)と仮定して外挿すると:

| N | handwritten(推定) | react(推定) |
|---|---|---|
| 10,000 | 約40分 | 約19分 |
| 100,000 | 約67時間 | 約32時間 |

(実測ではなくO(N^2)仮定での機械的な外挿。参考値。)

## メモリ(参考値)

`--smol`なし・`global.gc`未公開のため`bench/listener-strategy.ts`と同様
ノイズが大きい目安値。N=100,000でhandwrittenのヒープ増分(約785MB)が
reactの増分(約428MB)より大きい点は気になるが、GCタイミングに強く
左右されるため断定はできない(`bun --expose-gc`での再計測が今後の課題)。

## 結論: ADR-0005の見立てへの評価

ADR-0005は「keyed reuseのMapの帳簿コストはReact Fiberの帳簿コストと
同種」という見立てだった。**この見立ては実測では裏付けられず、
むしろ反証に近い結果になった** — mount・filterSwitch・removeOne・
toggleAllの4シナリオで、全N・一貫してhandwritten版(irisoutの生成
出力の上限値)がReact版より遅い(だいたい1.3〜3倍)。addOneのみ
ほぼ互角(N次第でどちらかがわずかに速い)。

「同種のコスト」ではなく「Reactの方が一貫して速い」という結果は、
Mapの帳簿コスト自体よりも、`createTodoItem()`がアイテムごとに
(a) `addEventListener`を3回(checkbox/button/span)呼び、
(b) ローカルクロージャを最大5個(`renderEditState`/`commitEdit`/`update`
+ addEventListenerのハンドラ3個)生成している点が効いている可能性が
高い。React側は単一の委譲リスナー(合成イベント)とフックベースの
再描画で、アイテムごとの個別リスナー登録・専用クロージャ生成を
そもそも行わない。この非対称性は`bench/listener-strategy.ts`が既に
示していた「直接addEventListenerは委譲よりアタッチコストで不利」
という結果と整合する。

## M5設計への示唆

- 「irisoutの生成コードがReactに性能で勝てる」という前提は、
  少なくとも現在のADR-0005パターン(アイテムごとの直接リスナー+
  複数クロージャ)のままでは成立しない。M5.5以降でこのパターンを
  拡張する前に、アイテムごとの直接リスナーを委譲方式に変更する
  コストとメリットを再検討する価値がある。
- 一方で速度差は数十倍ではなく1.3〜3倍程度であり、「irisoutは
  originally Reactより大幅に遅い」という結論でもない。M5+
  エスケープハッチという現在の優先度(ROADMAP.md)を覆すほどの
  緊急性はないと判断する。
- toggleAllのO(N^2)特性は実装(不変配列 + 1件ずつの更新)に起因する
  ものでReact/irisoutどちらの問題でもない。バッチ更新API(複数件を
  1回の`update_<list>()`呼び出しにまとめる)が要るなら、それは
  ADR-0005の対象範囲外の新規の設計論点になる。
