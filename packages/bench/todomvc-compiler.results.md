# コンパイラ生成TodoMVC性能計測

計測日: 2026-09-05 11:44 UTC。対象は次の3実装である。

| 実装           | 対象                                            | 条件                                         |
| -------------- | ----------------------------------------------- | -------------------------------------------- |
| コンパイラ生成 | `apps/examples/todomvc.jsx`の現在のcompiler出力 | 初期HTMLを生成し、`hydrateComponent()`を実行 |
| 手書き         | `apps/examples/todomvc.handwritten.js`          | keyed DOM再利用を実装した比較基準            |
| React          | `apps/examples/todomvc.react.tsx`               | React 19 productionを同梱                    |

手書き版は比較基準であり、irisoutの性能として扱わない。生成版のTodoItemは
同一ファイル内でコンパイル時に展開され、アイテムごとの`editing`をfactoryの
クロージャへ持つ。編集表示は`editing() ? <input /> : <span />`という自然な
JSX条件分岐である。

## 結論

3実装は初期表示、追加、完了トグル、フィルタ、編集開始・確定、削除の機能試験を
通過した。コンパイラ生成版はN=100/1,000/10,000の全サイズで、初期HTMLを
hydrateして同じ操作結果になった。

N=10,000の初期化中央値は、コンパイラ生成326.6ms、手書き46.4ms、React67.6ms。
生成版の更新は`toggleOne`、`textEdit`、`addOne`、`removeOne`で最短だった。
`filter`は全件走査と構造ユニットの着脱があるため、同Nでは生成版83.1ms、
手書き59.7ms、React105.1msだった。

List item factoryのマーカー参照は、イベント登録のたびに`__find__`を再実行せず、
factoryの冒頭で解決した参照を使う。今回の生成コード計数は、itemと内側条件分岐を
含む候補マーカー検索5個、イベント登録5個で一致した。mount中の実際の
`querySelector`はNに対して`2N`で、`querySelectorAll`は0回だった。

## 機能試験

| 操作                 | コンパイラ生成 | 手書き | React |
| -------------------- | -------------- | ------ | ----- |
| 初期表示             | 通過           | 通過   | 通過  |
| 追加                 | 通過           | 通過   | 通過  |
| 完了トグル1件        | 通過           | 通過   | 通過  |
| All/Active/Completed | 通過           | 通過   | 通過  |
| 編集開始・確定       | 通過           | 通過   | 通過  |
| 1件削除              | 通過           | 通過   | 通過  |

生成版は静的HTMLの範囲アンカーをhydrateし、List itemの新規生成時だけfactoryを
呼ぶ。既存keyのDOM、ローカル状態、イベントリスナーは再利用する。自然な
TodoItem条件分岐では、初期状態の各itemにcheckboxの`change`、表示中のspanの
`dblclick`、削除buttonの`click`が登録され、編集時にinputの`keydown`と`blur`が
追加される。

## 計測方法

- compiler出力は`compile()`で作った。N件計測用の初期Todo配列だけはメモリ上で
  `globalThis.__IRISOUT_BENCH_INITIAL_TODOS__`参照へ置き換えた。authoringファイル
  自体は変更していない。
- 各実装を同じChromiumの新しいpageへ読み込み、2回の予熱後7回実行して中央値を
  採用した。Reactのイベント反映は`flushSync()`で同期化した。
- 生成版のmountは、静的HTMLの`innerHTML`設定を計時外に置いてhydrateとList生成を
  測った。手書き版とReact版は空rootからDOM生成を測った。
- `toggleOne`、`textEdit`、`addOne`、`removeOne`、`filter`を測った。filterは
  ActiveとCompletedへの切り替えを1回の計測区間に含む。
- DOM変更は`MutationObserver`で記録した。JavaScriptヒープはCDPの強制GC後に
  `Runtime.getHeapUsage().usedSize`を取得し、N=1,000で3回の中央値を記録した。
  DOMのnative memoryは含まない。
- ブラウザはNixOS Chromium 152.0.7977.75、Nodeはv24.20.0、Linux x86_64である。

再現コマンド:

```sh
IRISOUT_TODOMVC_SIZES=100,1000,10000 \
IRISOUT_TODOMVC_REPEATS=7 \
IRISOUT_TODOMVC_WARMUPS=2 \
IRISOUT_TODOMVC_HEAP_SIZE=1000 \
IRISOUT_TODOMVC_HEAP_REPEATS=3 \
  bun run bench:todomvc-compiler
```

## 転送量

本番buildのminify済みJavaScriptとgzip値である。生成版HTMLは初期app shellを含み、
手書き版とReact版のHTMLはapp本体を空にしている。

| 実装           | JavaScript | JavaScript gzip | 初期HTML | 初期HTML gzip | 別レスポンスgzip合計 | 連結後gzip |
| -------------- | ---------: | --------------: | -------: | ------------: | -------------------: | ---------: |
| コンパイラ生成 |    7,599 B |         2,554 B |  1,151 B |         535 B |              3,089 B |    2,899 B |
| 手書き基準     |    2,492 B |         1,112 B |    772 B |         395 B |              1,507 B |    1,450 B |
| React          |  191,921 B |        59,911 B |    772 B |         395 B |             60,306 B |   60,263 B |

## 初期化

単位はms。各行は2回の予熱後7回の中央値である。

|      N | コンパイラ生成 | 手書き | React |
| -----: | -------------: | -----: | ----: |
|    100 |            4.0 |    0.6 |   1.3 |
|  1,000 |           44.4 |    5.2 |   7.4 |
| 10,000 |          326.6 |   46.4 |  67.6 |

生成版の時間には、初期HTMLの構築は含めず、hydrate後の範囲取得、template生成、
Listのkey照合、factory呼び出し、マーカー解決、イベント登録を含める。

## 更新時間

単位はms。`filter`はActiveとCompletedへの切り替えを含む。

|      N | 操作      | コンパイラ生成 | 手書き | React |
| -----: | --------- | -------------: | -----: | ----: |
|    100 | toggleOne |            0.1 |    0.4 |   0.5 |
|    100 | textEdit  |            0.1 |    1.3 |   0.5 |
|    100 | addOne    |            0.2 |    0.5 |   0.8 |
|    100 | removeOne |            0.2 |    0.4 |   0.6 |
|    100 | filter    |            1.0 |    0.7 |   1.1 |
|  1,000 | toggleOne |            0.4 |    3.2 |   3.5 |
|  1,000 | textEdit  |            0.4 |   11.5 |   2.7 |
|  1,000 | addOne    |            0.6 |    4.0 |   5.6 |
|  1,000 | removeOne |            0.5 |    3.7 |   3.0 |
|  1,000 | filter    |           11.3 |    6.3 |  10.1 |
| 10,000 | toggleOne |            3.6 |   36.2 |  33.0 |
| 10,000 | textEdit  |            3.0 |  148.7 |  32.1 |
| 10,000 | addOne    |            2.9 |   38.0 |  66.3 |
| 10,000 | removeOne |            2.7 |   36.3 |  28.8 |
| 10,000 | filter    |           83.1 |   59.7 | 105.1 |

## DOM変更とmount内部

N=1,000の`MutationObserver`記録は、`childList/attribute/characterData`の順である。

| 操作      | コンパイラ生成 |    手書き |         React |
| --------- | -------------: | --------: | ------------: |
| toggleOne |          1/1/0 | 3,001/1/0 |     0/3,006/1 |
| textEdit  |          3/1/0 | 3,000/2/0 |     2/3,002/0 |
| addOne    |          2/0/0 | 3,002/0/0 |     1/6,008/1 |
| removeOne |          2/0/0 | 2,999/0/0 |     1/2,999/1 |
| filter    |      1,500/0/0 | 4,500/0/0 | 1,500/1,504/0 |

mount中の操作数は次の式で、N=100/1,000/10,000で確認した。生成版の静的な
factory候補には5個のイベント登録があるが、初期表示では編集input branchが未選択
なので実リスナーは3N+4である。

| 実装           | 実リスナー | item上 | item外/root | `querySelector` | `querySelectorAll` |
| -------------- | ---------: | -----: | ----------: | --------------: | -----------------: |
| コンパイラ生成 |       3N+4 |     3N |           4 |              2N |                  0 |
| 手書き基準     |       3N+4 |     3N |           4 |            3N+6 |                  0 |
| React          |      N+140 |      N |         140 |               0 |                  0 |

## JavaScriptヒープ

N=1,000、3回の中央値。bench driver読み込み直後の強制GC済みbaselineからの
JavaScriptヒープ増分であり、DOM/native memoryは含まない。

| 段階           | コンパイラ生成 |    手書き |       React |
| -------------- | -------------: | --------: | ----------: |
| mount後        |      911,068 B | 534,180 B | 1,801,736 B |
| 1件更新後      |      934,264 B | 550,344 B | 2,759,232 B |
| 全件削除後     |      190,124 B | 176,020 B |   977,420 B |
| unmount/解放後 |      180,292 B | 174,804 B |   803,764 B |

生成版は、itemごとの状態、handler closure、binding Map、List/conditionalの状態を
保持するため、mount後・更新後は手書き版より大きい。全件削除後はList handleが
解放され、手書き版と近い値になる。React値にはFiberとReactDOMの保持分が含まれる。

## 生成コードとmarker lookup

`CompileResult.code`の静的計数、production bundle、mount中の計数を記録した。

| 指標                                         |           値 |
| -------------------------------------------- | -----------: |
| コンパイラ生成コード                         | 13,029 bytes |
| 生成初期HTML                                 |    379 bytes |
| 関数定義                                     |           22 |
| component factory                            |            8 |
| factory内マーカー検索                        |            5 |
| factory内イベント登録                        |            5 |
| top-levelイベント登録（mount/hydrateの合計） |            8 |
| template初期化（mount/hydrateの合計）        |            8 |
| `visibleTodos`再計算                         |            3 |
| active count式                               |            2 |
| `updateListBinding`呼出し                    |            4 |
| `__findRange__`定義/呼出し                   |        1 / 2 |

前回のTodoMVC生成物は、item markerの解決とイベント配線で同じmarkerを別々に
`__find__`しており、静的計数はmarker解決4個とイベント配線5個の計9個だった。

## R3候補の再計測(2026-09-07)

初回Listの`DocumentFragment`挿入、初回key照合の短縮、item handler callback共有を
反映した作業状態を、同じ計測driverで再計測した。ChromiumはNixOS Chromium
152.0.7977.82、2回の予熱後7回、N=10,000である。旧記録は152.0.7977.75のため、
この表は20%短縮の完了判定には使わず、候補の観測値として扱う。

| 実装           |  初期化 | toggleOne | textEdit | addOne | removeOne |  filter |
| -------------- | ------: | --------: | -------: | -----: | --------: | ------: |
| コンパイラ生成 | 311.9ms |     2.9ms |    2.8ms |  2.6ms |     3.1ms |  88.3ms |
| 手書き         |  45.7ms |    37.7ms |  130.9ms | 35.6ms |    37.4ms |  67.5ms |
| React          |  66.9ms |    30.9ms |   32.6ms | 59.5ms |    29.8ms | 117.9ms |

生成版のlistenerは30,004件、item内listenerは30,000件、`querySelector`は20,000回で、
直接配線のイベント意味論を維持した。旧記録の生成版初期化326.6msとの差は約4.5%で、
目標の20%には届かない。同一Chromiumと同一生成物を固定した基準測定を行い、追加改善か
目標改訂を決める。
今回はfactoryで5個の参照を一度だけ解決し、5個の登録がその参照を使う。なお今回の
fixtureでは同時に、常時表示していたinputを条件分岐へ変更した。したがって実行時の
`querySelector`が前回の8Nから今回の2Nになった差は、参照再利用と条件分岐の形変更を
合算した値であり、参照再利用だけの寄与として扱わない。

生成版が使うruntime helperは`mountWithRanges`、`hydrateWithRanges`、
`createListRuntime`、`reconcileList`、`updateListBinding`である。production JavaScript
にcompiler本体は含まれない。

## R3同一条件の基準比較(2026-09-07)

R3の対象をList初期化へ限定するため、計測用compiler variantではListと無関係な
`setupNewTodoInput`の`focus()` actionを除いた。実アプリの生成物と機能試験ではactionを
残している。Chromium 152.0.7977.82、予熱3回後15回、N=10,000の中央値で、初期化経路の
最適化を無効にした同一生成物を基準にした。

| 経路                                               | 初期化中央値 | 基準からの差 |
| -------------------------------------------------- | -----------: | -----------: |
| 最適化前（初回`Set`・個別挿入・selector探索）      |       82.7ms |            — |
| 現行（初回経路分岐・`DocumentFragment`・要素走査） |       69.9ms |    15.5%短縮 |

現行の他操作は`toggleOne` 3.3ms、`textEdit` 3.0ms、`addOne` 3.4ms、`removeOne` 3.1ms、
`filter` 48.7msであった。20%短縮の条件は満たしていないため、R3は追加改善または目標
改訂の判断待ちとする。`focus()`を含む従来値との比較は初期化対象が異なるため、完了判定へ
使わない。現行生成版の本番JavaScriptは8,049 bytes（gzip 2,714 bytes）、mount後の
JavaScriptヒープ増分はN=1,000で924,160 bytes、item markerの`querySelector`呼出しは0回
だった。

## R3追加計測: 初期条件分岐DOMの引き取り (2026-09-08)

TodoItemの`editing = signal(false)`で初回に選択されるspan枝を、リスト項目templateへ
含めてbranch factoryが引き取る実装を追加した。条件式が項目値を読む場合、lifecycle・
入れ子構造・SVG名前空間を含む場合は従来のbranch clone経路を使う。初回枝のイベント登録、
編集切替、同じkeyの更新は回帰試験で確認した。

旧基準は親コミット`e645893`を`/tmp/irisout-r3-old-e645893`へ展開し、現作業木へ
変更を戻さずに実行した。両方ともChromium 152.0.7977.82、計測入力、初期focus除外、
予熱3回、15回の中央値、N=100/1,000/10,000、ヒープ5回である。最終実装の比較では
旧版86.6ms、実装版74.0msとなった。同条件の前回候補計測は旧版78.3ms、候補版74.7ms
だったため、環境ばらつきを含めて記録する。実行コマンドは次のとおりで、作業木と旧展開の
それぞれで同じ値を指定した。

```sh
IRISOUT_TODOMVC_SIZES=100,1000,10000 \
IRISOUT_TODOMVC_REPEATS=15 \
IRISOUT_TODOMVC_WARMUPS=3 \
IRISOUT_TODOMVC_HEAP_SIZE=1000 \
IRISOUT_TODOMVC_HEAP_REPEATS=5 \
IRISOUT_TODOMVC_JSON_PATH=/tmp/irisout-r3-adoption-final2-20260908.json \
  bun run bench:todomvc-compiler
```

### 初期化と更新

生成版の初期化中央値は次のとおりである。

|      N | 旧基準 | 実装版 |   差分 |
| -----: | -----: | -----: | -----: |
|    100 |  0.9ms |  1.0ms | +11.1% |
|  1,000 |  8.9ms |  8.1ms |  -9.0% |
| 10,000 | 86.6ms | 74.0ms | -14.5% |

N=10,000の通常更新は`toggleOne` 3.5ms→3.4ms、`textEdit` 3.5ms→3.4ms、
`addOne` 3.6ms→3.2ms、`removeOne` 3.4ms→3.3ms、`filter` 62.4ms→50.5msだった。
更新値には増減があり、同一環境の一回の計測結果なので初期化以外の効果は判定しない。

### 転送量とヒープ

| 指標                     |   旧基準 |   実装版 |  差分 |
| ------------------------ | -------: | -------: | ----: |
| 生成JavaScript           |   8,293B |   8,498B | +2.5% |
| 生成JavaScript gzip      |   2,733B |   2,807B | +2.7% |
| 初期HTML gzip            |     532B |     532B |     0 |
| gzip合計                 |   3,265B |   3,339B | +2.3% |
| N=1,000 mount後ヒープ    | 926,800B | 932,556B | +0.6% |
| N=1,000 1件更新後ヒープ  | 943,928B | 949,660B | +0.6% |
| N=1,000 全件削除後ヒープ | 197,456B | 197,776B | +0.2% |
| N=1,000 unmount後ヒープ  | 188,968B | 189,300B | +0.2% |

mount内部の生成版は旧基準・実装版ともN=10,000でlistener 30,004件、
`querySelector` 0回だった。機能試験は両版の生成・手書き・Reactで通過した。
20%短縮は未達であり、この計測だけでR3完了や目標達成を宣言しない。以前の82.7msは
今回再実行していない過去値なので、新旧比較には使わない。限定適用は正しさと初期化
短縮の根拠があるため採用するが、20%目標達成とは扱わない。

生データの絶対パスは次のとおりである。

- 旧基準（最終比較）: `/tmp/irisout-r3-adoption-old-e645893-final-20260908.json`
- 実装版（最終比較）: `/tmp/irisout-r3-adoption-final2-20260908.json`
- 前回候補比較: `/tmp/irisout-r3-adoption-old-e645893-20260908.json`、`/tmp/irisout-r3-adoption-final-20260908.json`
- 初期化内訳の実装版（最終コード、予熱10回・100回）: `/tmp/irisout-r3-adoption-breakdown-final2-20260908.json`

## 制約

- 単一のNixOS Chromiumでの相対比較であり、絶対時間を他環境へ外挿しない。
- JavaScriptヒープはnative DOM memory、EventListenerの内部保持、layout、paintを
  含まない。
- TodoMVC fixtureに並べ替え操作はない。keyed reorderはList playgroundで別に確認する。
- 生成版はfilterで可視集合から外れたitemをListの対象から外す。全件非表示で外側
  条件分岐が非マウントになると、内側のitem状態は破棄して作り直す仕様である。
- `collection.update()`を使う直接item通知は、このTodoMVC fixtureでは使っていない。
