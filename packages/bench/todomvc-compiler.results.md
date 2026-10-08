# コンパイラ生成TodoMVC性能計測

計測日: 2026-10-08。比較対象は `packages/bench/todomvc-compiler.playwright.ts` のコンパイラ生成版とReact版。手書き版も参考値として掲載する。

## 結果

生成版はN=100/1,000/10,000の全18計測セルで、React以下の中央値となった。各セルは5回予熱し、31回計測した。N=1,000のmountは生成版4.8ms、React7.1msだった。

単位はms。filterはActiveとCompletedへの切り替えを含む。textEditは編集開始を計時外に置き、Enterによる確定を計時する。

|      N | 指標      | 生成版 | React |
| -----: | --------- | -----: | ----: |
|    100 | mount     |    0.6 |   1.2 |
|    100 | toggleOne |    0.1 |   0.3 |
|    100 | textEdit  |    0.1 |   0.3 |
|    100 | addOne    |    0.1 |   0.6 |
|    100 | removeOne |    0.1 |   0.3 |
|    100 | filter    |    0.5 |   1.0 |
|  1,000 | mount     |    4.7 |   7.2 |
|  1,000 | toggleOne |    0.2 |   1.9 |
|  1,000 | textEdit  |    0.2 |   1.7 |
|  1,000 | addOne    |    0.3 |   3.6 |
|  1,000 | removeOne |    0.2 |   2.1 |
|  1,000 | filter    |    3.7 |   6.3 |
| 10,000 | mount     |   42.1 |  68.7 |
| 10,000 | toggleOne |    2.0 |  21.8 |
| 10,000 | textEdit  |    1.9 |  23.5 |
| 10,000 | addOne    |    2.2 |  55.2 |
| 10,000 | removeOne |    2.0 |  24.6 |
| 10,000 | filter    |   33.7 | 108.0 |

## 転送量とヒープ

本番buildのJavaScriptは生成版8,942B / gzip 2,936B、React192,679B / gzip60,728B。初期HTMLを別レスポンスとして加算したgzip合計は生成版3,467B、React61,119B。生成版HTMLにはTodoMVC shellが含まれ、React版HTMLは空rootのため、HTML単体のサイズは同条件ではない。

N=1,000のJavaScript heapは5回計測した中央値。DOMのnative memoryは含めない。

| 状態       |   生成版 |      React |
| ---------- | -------: | ---------: |
| mount後    | 454,664B | 1,697,592B |
| update後   | 473,832B | 2,570,628B |
| 全件削除後 | 190,820B |   980,952B |
| unmount後  | 187,052B |   805,728B |

生成版のイベント登録は全サイズで9件だった。各Todoにはlistenerを登録せず、change/click/dblclick/keydown/focusoutを一覧で処理する。編集時にだけinputを作り、コンパイラが更新するspanを保持して編集確定後に戻す。行ごとのediting signal、条件分岐factory、編集callbackをなくした。React比較fixtureにも一覧側のイベント処理を適用した。コンパイラの既定イベント登録やイベント意味は変更していない。

## 計測条件

- N=100/1,000/10,000、Chromium 154.0.8037.57、5回予熱 + 31回計測、中央値。
- mountは空rootから計る。生成版は`mountComponent()`、Reactは`createRoot()`と`flushSync()`を計時区間に含む。以前は生成版のみ初期HTMLをhydrateし、Reactは空rootからmountしていたため、空root条件に揃えた。
- 更新操作は初期表示後、対象決定・イベント設定を計時外に置き、DOM更新を含む操作だけを計る。textEditの編集開始は計時外、Enter確定は計時内。filterはActiveとCompletedを切り替える。
- 同一Chromium、同一入力、同一driverで実行した。初期/add/toggle/filter/edit/removeの機能結果を3実装で確認した。
- heapはN=1,000、各実装5回。強制GC後のJavaScript heapを取得した。DOM native memoryは含めない。

再現コマンド:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium \
IRISOUT_TODOMVC_SIZES=100,1000,10000 \
IRISOUT_TODOMVC_REPEATS=31 \
IRISOUT_TODOMVC_WARMUPS=5 \
IRISOUT_TODOMVC_HEAP_SIZE=1000 \
IRISOUT_TODOMVC_HEAP_REPEATS=5 \
  bun run bench:todomvc-compiler
```
