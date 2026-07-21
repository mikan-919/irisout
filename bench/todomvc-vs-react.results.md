# todomvc-vs-react ベンチマーク結果

change: `perf-bench-todomvc-vs-react`。実行: `bun run bench/todomvc-vs-react.ts`
(要 `NODE_ENV=production` — react-dom を production ビルドで動かすため。
未指定でも動くがReact側のdev checkのぶん遅くなる)。

> **注意(2026-07-14 追記): 以下のjsdom計測の結論は、実ブラウザでの
> 再計測(下記「実ブラウザ(Chromium)での再計測」)で覆った。** jsdomは
> DOM APIをすべてJSで実装しており「DOMを触るほど損」という実ブラウザと
> 逆のコストモデルを持つため、直接DOM操作の多いhandwritten版を系統的に
> 不利にする。jsdomの数値と当時の結論は経緯の記録として残す。

## 方法(jsdom)

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

## 結論(jsdom時点・撤回済み): ADR-0005の見立てへの評価

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

## M5設計への示唆(jsdom時点・撤回済み)

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

## 実ブラウザ(Chromium)での再計測(2026-07-14)

実行: `bun bench/todomvc-vs-react.playwright.ts`
(要 `bunx playwright install chromium`)。

### jsdom計測の方法論的問題

上記jsdom計測には、いずれもReact側に系統的に有利に働く問題が3つあった:

1. **環境がコストモデルを反転させる(本質)。** この比較は「DOMを直接
   たくさん触る戦略」vs「自前のJSでdiffしてDOMを最小限しか触らない戦略」
   の対決なのに、jsdomではDOM APIの呼び出しそのものが遅いJS(parse5の
   HTMLパーサ、JS実装のイベント伝播・cloneNode・リスナー簿記)である
   ため、DOMを避けるReactの戦略が構造的に有利になる。実ブラウザでは
   DOM呼び出しは安いネイティブコールで、この関係は逆転する。
2. **1回計測・ウォームアップなし。** N=100→1,000(件数10倍)でmountが
   2倍強にしか増えない = N=100の数値の大半がコールドスタート固定費
   だった。絶対値でも、jsdomのmount N=100は61ms、実Chromiumでは0.6ms
   (約100倍差)で、jsdom計測はjsdom自身のオーバーヘッドを測っていた。
3. **実行順固定(handwritten→react)。** 常にhandwrittenがコールド状態、
   Reactが直前の実行で温まった状態で走る。

### 方法

- シナリオ・fixture・`flushSync`・`.click()`の扱いはjsdom版と同一。
  シナリオ本体(`bench/browser-driver.ts`)とfixture・Reactを`Bun.build`で
  1本のESMバンドルにしてページへ注入し(`NODE_ENV=production`はdefineで
  焼き込み)、計測はすべて**ページ内**の`performance.now()`で行う
  (Node側で計るとCDP往復(1操作あたり数ms)を測ることになるため)。
- 各セルはウォームアップ1回(捨てる)+ 5回計測の**中央値**。
- heap計測はしない(Nodeプロセスのheapはブラウザと無関係)。
- N=100の各セルはタイマー分解能(0.1ms)に近い粗い参考値。
- addOneのReact側はcontrolled inputの`input`イベント再レンダー1回分を
  含む(素朴な標準React実装が同じユーザー操作に対して払う実コスト。
  jsdom版と同条件)。

### 結果: mount / filterSwitch / addOne / removeOne(N=100〜100,000)

| N | scenario | handwritten (ms) | react (ms) | react/handwritten |
|---|---|---|---|---|
| 100 | mount | 0.60 | 1.30 | 2.17x |
| 100 | filterSwitch | 0.30 | 0.50 | 1.67x |
| 100 | addOne | 0.20 | 0.80 | 4.00x |
| 100 | removeOne | 0.20 | 0.30 | 1.50x |
| 1,000 | mount | 4.60 | 7.90 | 1.72x |
| 1,000 | filterSwitch | 3.30 | 3.60 | 1.09x |
| 1,000 | addOne | 1.70 | 5.00 | 2.94x |
| 1,000 | removeOne | 1.70 | 1.90 | 1.12x |
| 10,000 | mount | 39.50 | 68.70 | 1.74x |
| 10,000 | filterSwitch | 30.30 | 45.20 | 1.49x |
| 10,000 | addOne | 19.80 | 50.80 | 2.57x |
| 10,000 | removeOne | 18.40 | 24.20 | 1.32x |
| 100,000 | mount | 420.80 | 741.50 | 1.76x |
| 100,000 | filterSwitch | 305.00 | 469.00 | 1.54x |
| 100,000 | addOne | 279.20 | 562.80 | 2.02x |
| 100,000 | removeOne | 191.70 | 273.70 | 1.43x |

(ratio = react ÷ handwritten。**1.0超はhandwrittenの方が速い。**
jsdom計測の同じ列は0.32〜0.71xだった — 全面逆転。)

`addOnePreservedExisting`は全N・全実行でtrue(jsdom版と同じ検証)。

### 結果: toggleAll(N=100, 1,000のみ)

| N | handwritten (ms) | react (ms) | react/handwritten |
|---|---|---|---|
| 100 | 15.60 | 20.40 | 1.31x |
| 1,000 | 1,071.70 | 1,544.10 | 1.44x |

### 結論(改訂): jsdomの「反証」は環境アーティファクトだった

実Chromiumでは**全シナリオ・全Nでhandwritten版がReact版より速い**
(1.1〜4倍、中心は1.4〜1.8倍)。この方向と倍率はjs-framework-benchmark
(実Chrome)でvanilla系keyed実装がReactに対して示す差(React側が
1.4〜1.6倍遅い)とも整合する。

- ADR-0005の見立て「keyed reuseのMapの帳簿コストはReact Fiberと同種」は
  **支持された**。実ブラウザでは同種どころか一貫して安い。
- jsdom計測が疑わせた「アイテムごとの直接`addEventListener`×3・
  クロージャ×5生成が効いている」は、実ブラウザでは支配的でなかった。
  **委譲方式への変更に性能上の動機はない**(メモリ面の比較は未計測の
  まま残る)。
- 本ベンチが測るのは同期JS時間(スタイル・レイアウト・ペイントは両実装
  とも計測区間外)。両実装が最終的に作るDOMはほぼ同一なので、この比較
  には影響しない。
