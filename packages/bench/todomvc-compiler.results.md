# コンパイラ生成TodoMVC性能計測

計測日: 2026-09-05 09:01 UTC。対象は次の3実装である。

| 実装           | 対象                                                      | 性質                                                       |
| -------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| コンパイラ生成 | `apps/examples/todomvc.jsx`を現在のcompilerで処理した出力 | `hydrateComponent()`を使用。コンパイラ本体は含まない       |
| 手書き         | `apps/examples/todomvc.handwritten.js`                    | keyed DOM再利用を実装した比較基準。irisoutの生成物ではない |
| React          | `apps/examples/todomvc.react.tsx`                         | React 19 productionとReactDOMを同梱                        |

手書き版は比較基準であり、irisoutの性能として扱わない。

## 技術要約

3実装は初期表示、追加、完了トグル、All/Active/Completed、編集開始・確定、削除の機能試験を通過した。コンパイラ生成版は初期HTMLを使ってhydrateし、手書き版とReact版は空のrootへmountする。

N=10,000の初期化中央値は、コンパイラ生成441.3ms、手書き50.1ms、React71.7msだった。コンパイラ生成版の初期化は、手書き版の8.81倍、Reactの6.15倍である。一方、1件のトグル、テキスト変更、追加、削除ではコンパイラ生成版が3サイズで最短だった。フィルタは全件走査とkeyed Listの着脱が発生し、N=10,000で127.1msとなった。

現在の生成物で時間とDOM操作が集中する箇所は初期化である。N=10,000の生成版は、itemごとに5個のイベントリスナーを登録し、`querySelector`を80,000回実行する。次の最適化は、item factoryで既に解決したmarker参照をイベント配線でも使い回すことである。

## 機能試験と差異

性能計測の前に、各実装を新しいページへ読み込み、次の順で試験した。

| 操作                 | コンパイラ生成 | 手書き | React |
| -------------------- | -------------- | ------ | ----- |
| 初期表示             | 通過           | 通過   | 通過  |
| 追加                 | 通過           | 通過   | 通過  |
| 完了トグル1件        | 通過           | 通過   | 通過  |
| All/Active/Completed | 通過           | 通過   | 通過  |
| 編集開始・確定       | 通過           | 通過   | 通過  |
| 1件削除              | 通過           | 通過   | 通過  |

機能試験で確認した差異は次のとおりである。

- コンパイラ生成版はVite+が生成した初期HTMLを`hydrateComponent()`へ渡す。手書き版とReact版は`<div id="app"></div>`から開始して、それぞれDOM生成またはReactのmountを行う。
- コンパイラ生成版はListを開始・終了コメントの範囲で管理する。手書き版とReact版は初期状態から`<ul>`を作る。生成版は表示対象が空になるとListを含む条件分岐を着脱し、手書き版とReact版は`<ul hidden>`を残す。
- 手書き版はフィルタで非表示になったitemのhandleをMapへ残す。現在の生成版の`reconcileList()`は表示配列から外れたitemのhandleをMapから削除する。この差異による編集中のローカル状態の保持は今回の機能試験の対象外である。
- 編集中のDOMも異なる。生成版はitem内の条件分岐、手書き版はinputの生成と表示切り替え、React版はbuttonとinputの切り替えを使う。したがってDOM変更数は見た目の差ではなく、各実装の更新方式の差を表す。
- コンパイラ生成版とReact版にはinstanceを解放する`unmount`がある。手書き版には対応するAPIがなく、ヒープ計測ではcontainerの除去を解放処理として扱った。
- 現在のTodoMVC fixtureには並べ替え操作がないため、reorderは計測していない。並べ替えを持つList playgroundの数値はこの比較へ混ぜていない。

## 計測方法

- compiler出力は`compile()`でメモリ上に作った。authoringファイルは変更していない。N件計測用に初期`signal([...])`だけをメモリ上で`globalThis.__IRISOUT_BENCH_INITIAL_TODOS__`参照へ置き換えた別出力を作り、実際の機能試験は元のコンパイラ出力で行った。
- 本番ビルドはVite+、minify有効、`external: []`で作った。生成版はコンパイラ出力と必要な`@irisout/runtime`だけを入力にした。React版はReact productionとReactDOMを同じJavaScriptへ含めた。生成版production JavaScriptに`@babel/`または`parseExpression`は見つからなかった。
- 転送量のHTMLは、生成版がVite+の初期HTML、手書き版とReact版が同じVite+のshellからapp本体だけを空にしたものだ。初期データは元のfixtureと同じ2件である。gzip値はHTMLとJavaScriptを別レスポンスとして圧縮した合計を主値とし、連結後の圧縮値も記録した。
- ブラウザはNixOS Chromium 152.0.7977.75を使用した。各実装・各操作・各Nで新しいページを作り、2回の予熱後に7回実行して中央値を採用した。Reactのイベントは`flushSync()`で1操作ごとに同期反映した。
- mountの計時は、生成版では静的HTMLの`innerHTML`設定を計時外に置き、hydrateとList生成を計時した。手書き版とReact版は空rootを計時前に用意し、DOM生成を計時した。この比較は生成版の初期HTML転送とhydrate、他2実装のmountを別々に測る条件である。
- 更新では`toggleOne`、`textEdit`、`addOne`、`removeOne`、`filter`を測った。`filter`は交互に完了状態を持つN件へActiveを適用し、その後Completedへ切り替えた。`textEdit`の編集開始は計時前、確定操作だけを計時した。
- `MutationObserver`を更新操作の直前に設定し、`childList`、属性、文字データ、`li`の付着・離脱、新規・破棄、既存itemの変更、既存itemの再挿入を数えた。
- JavaScriptヒープはCDPの`Runtime.getHeapUsage().usedSize`を`HeapProfiler.collectGarbage`後に取得した。N=1,000で、mount後、1件更新後、全件削除後、解放処理後を3回測った。生成版とReact版では解放処理が`unmount`、手書き版ではcontainer除去である。値はページへbench driverを読み込んだ直後との差分であり、ブラウザのnative DOMメモリは含まない。全件削除は各itemの削除ボタンを順に押すライフサイクル確認で、更新時間の表には含めていない。

再現コマンドは次のとおりである。

```sh
IRISOUT_TODOMVC_SIZES=100,1000,10000 \
IRISOUT_TODOMVC_REPEATS=7 \
IRISOUT_TODOMVC_WARMUPS=2 \
IRISOUT_TODOMVC_HEAP_SIZE=1000 \
IRISOUT_TODOMVC_HEAP_REPEATS=3 \
bun run bench:todomvc-compiler
```

## 転送量

生成版のHTMLは初期状態のapp shellを含む。手書き版とReact版は初期HTMLへappのtodo DOMを焼き込んでいない。

| 実装           | JavaScript bytes | JavaScript gzip | 初期HTML bytes | 初期HTML gzip | HTML+JavaScript gzip合計 | 連結後gzip |
| -------------- | ---------------: | --------------: | -------------: | ------------: | -----------------------: | ---------: |
| コンパイラ生成 |            6,821 |           2,380 |          1,150 |           539 |                    2,919 |      2,731 |
| 手書き基準     |            2,492 |           1,111 |            772 |           395 |                    1,506 |      1,442 |
| React          |          191,921 |          59,874 |            772 |           395 |                   60,269 |     60,237 |

| 比率                    | JavaScript bytes | JavaScript gzip | HTML bytes | HTML gzip | HTML+JavaScript gzip合計 |
| ----------------------- | ---------------: | --------------: | ---------: | --------: | -----------------------: |
| コンパイラ生成 ÷ 手書き |            2.74x |           2.14x |      1.49x |     1.36x |                    1.94x |
| コンパイラ生成 ÷ React  |            0.04x |           0.04x |      1.49x |     1.36x |                    0.05x |

生成版は手書き版より初期HTMLとJavaScriptの合計gzipが1.94倍である。React版はReact productionを含むためJavaScript gzipが59,874 bytesとなる。

## 初期化

単位はms、各行は2回の予熱後7回の中央値である。比率はコンパイラ生成 ÷ 比較対象である。

|      N | コンパイラ生成 | 手書き | React | 生成/手書き | 生成/React |
| -----: | -------------: | -----: | ----: | ----------: | ---------: |
|    100 |            7.5 |    0.6 |   1.6 |      12.50x |      4.69x |
|  1,000 |           47.8 |    5.4 |   8.6 |       8.85x |      5.56x |
| 10,000 |          441.3 |   50.1 |  71.7 |       8.81x |      6.15x |

生成版のmountは静的HTMLの構築を含まず、hydrate後に生成するList、item factory、marker探索、イベント登録を含む。

## 更新時間

単位はms。`filter`はActiveへの切り替えとCompletedへの切り替えを1セルで測った。

|      N | 操作      | コンパイラ生成 | 手書き | React | 生成/手書き | 生成/React |
| -----: | --------- | -------------: | -----: | ----: | ----------: | ---------: |
|    100 | toggleOne |            0.1 |    0.4 |   0.5 |       0.25x |      0.20x |
|    100 | textEdit  |            0.1 |    1.5 |   0.4 |       0.07x |      0.25x |
|    100 | addOne    |            0.1 |    0.4 |   0.9 |       0.25x |      0.11x |
|    100 | removeOne |            0.2 |    0.5 |   0.6 |       0.40x |      0.33x |
|    100 | filter    |            1.2 |    0.6 |   1.3 |       2.00x |      0.92x |
|  1,000 | toggleOne |            0.4 |    3.8 |   3.0 |       0.11x |      0.13x |
|  1,000 | textEdit  |            0.3 |   11.5 |   2.9 |       0.03x |      0.10x |
|  1,000 | addOne    |            0.4 |    3.7 |   5.9 |       0.11x |      0.07x |
|  1,000 | removeOne |            0.4 |    3.3 |   3.2 |       0.12x |      0.13x |
|  1,000 | filter    |           11.1 |    5.5 |   9.9 |       2.02x |      1.12x |
| 10,000 | toggleOne |            2.4 |   37.9 |  29.5 |       0.06x |      0.08x |
| 10,000 | textEdit  |            2.4 |  129.0 |  31.5 |       0.02x |      0.08x |
| 10,000 | addOne    |            2.4 |   39.4 |  58.4 |       0.06x |      0.04x |
| 10,000 | removeOne |            2.5 |   38.3 |  30.6 |       0.07x |      0.08x |
| 10,000 | filter    |          127.1 |   65.9 | 110.4 |       1.93x |      1.15x |

N=10,000では、生成版はtoggleOneで手書きの15.8分の1、textEditで53.8分の1、addOneで16.4分の1、removeOneで15.3分の1だった。filterだけは手書き版が速い。手書き版は表示対象の既存DOMを全件再appendするため、時間とDOM操作数の関係は生成版と異なる。

## DOM変更

次の表はN=1,000の中央値である。`DOM記録`は`childList/attributes/characterData`の順、`LI付着/離脱`はMutationObserverの追加・削除ノードに含まれた既存または新規`li`数、`新規/破棄`は操作前後のidentity比較、`変更LI`は操作中に子孫または自身の変更を観測した操作前の`li`数である。`移動LI`は同じListへ再挿入された既存`li`数である。

| 操作      | 実装           |     DOM記録 | LI付着/離脱 | 新規/破棄 | 変更LI | 無関係Todo DOM変更 | 移動LI | List再配置 |
| --------- | -------------- | ----------: | ----------: | --------: | -----: | ------------------ | -----: | ---------- |
| toggleOne | コンパイラ生成 |       1/1/0 |         0/0 |       0/0 |      1 | いいえ             |      0 | いいえ     |
| toggleOne | 手書き         |    3001/1/0 |   1000/1000 |       0/0 |   1000 | はい               |   1000 | はい       |
| toggleOne | React          |    0/3006/1 |         0/0 |       0/0 |   1000 | はい               |      0 | いいえ     |
| textEdit  | コンパイラ生成 |       2/0/0 |         0/0 |       0/0 |      1 | いいえ             |      0 | いいえ     |
| textEdit  | 手書き         |    3000/2/0 |   1000/1000 |       0/0 |   1000 | はい               |   1000 | はい       |
| textEdit  | React          |    2/3002/0 |         0/0 |       0/0 |   1000 | はい               |      0 | いいえ     |
| addOne    | コンパイラ生成 |       2/0/0 |         1/0 |       1/0 |      0 | いいえ             |      0 | いいえ     |
| addOne    | 手書き         |    3002/0/0 |   1001/1000 |       1/0 |   1000 | はい               |   1000 | はい       |
| addOne    | React          |    1/6008/1 |         1/0 |       1/0 |   1000 | はい               |      0 | いいえ     |
| removeOne | コンパイラ生成 |       2/0/0 |         0/1 |       0/1 |      1 | いいえ             |      0 | いいえ     |
| removeOne | 手書き         |    2999/0/0 |    999/1000 |       0/1 |   1000 | はい               |    999 | はい       |
| removeOne | React          |    1/2999/1 |         0/1 |       0/1 |   1000 | はい               |      0 | いいえ     |
| filter    | コンパイラ生成 |    1500/0/0 |    500/1000 |  500/1000 |   1000 | はい*              |      0 | いいえ     |
| filter    | 手書き         |    4500/0/0 |   1000/1500 |     0/500 |   1000 | はい*              |    500 | はい       |
| filter    | React          | 1500/1504/0 |    500/1000 |  500/1000 |   1000 | はい*              |      0 | いいえ     |

`filter`には単一の対象itemがないため、`はい*`は2回のフィルタ切り替えで複数の既存itemが変更されたことを示す。生成版の1件更新は対象itemだけを変更し、既存Listを移動しない。手書き版は`update_todos()`内で全件を`appendChild()`するため、既存itemの再挿入とList再配置が全更新で発生する。ReactはListの既存identityを保つが、このfixtureでは再描画により既存itemの属性変更を観測した。

Nを変えたときの`MutationObserver`記録数は次の式で再現でき、N=100、1,000、10,000で確認した。

| 実装           | toggleOne | textEdit | addOne | removeOne | filter |
| -------------- | --------: | -------: | -----: | --------: | -----: |
| コンパイラ生成 |         2 |        2 |      2 |         2 |   1.5N |
| 手書き         |      3N+2 |     3N+2 |   3N+2 |      3N-1 |   4.5N |
| React          |      3N+7 |     3N+4 |  6N+10 |      3N+1 |   3N+4 |

付着・離脱とidentityの差は次のとおりである。

- 生成版: toggle/text/removeは0/0、addは1/0、filterはN/2とN。filterでは表示配列から外れたitemを破棄し、次の切り替えで再生成する。
- 手書き版: toggle/textはN/N、addはN+1/N、removeはN-1/N、filterはN/1.5N。フィルタ非表示itemのhandleを保持する。
- React: toggle/textは0/0、addは1/0、removeは0/1、filterはN/2とN。Reactの再描画で既存itemの属性記録は増えるが、既存`li`の再挿入は観測しなかった。

## mount内部の操作数

mount中だけ`addEventListener`、`querySelector`、`querySelectorAll`を計数した。Nに対する実測式は次のとおりである。`querySelectorAll`は3実装で0回だった。

| 実装           | 全リスナー | item上のリスナー | item外・root等 | `querySelector` |
| -------------- | ---------: | ---------------: | -------------: | --------------: |
| コンパイラ生成 |       5N+4 |               5N |              4 |              8N |
| 手書き         |       3N+4 |               3N |              4 |            3N+6 |
| React          |      N+140 |                N |            140 |               0 |

N=1,000では生成版が5,004リスナーと8,000回の`querySelector`、手書き版が3,004リスナーと3,006回、Reactが1,140リスナーと0回だった。生成版の5個はcheckboxのchange、textのdblclick、編集inputのkeydownとblur、削除buttonのclickである。top-levelのinputと3個のfilter buttonへは4個を登録する。ReactのN個はこのChromiumでcheckboxごとに観測した`invalid`リスナーで、残りはReactのイベント委譲用登録である。

## JavaScriptヒープ

値はN=1,000、3回の中央値で、bench driver読み込み後の強制GC済みbaselineからの増分bytesである。

| 段階       | コンパイラ生成 |  手書き |     React | 生成/手書き | 生成/React |
| ---------- | -------------: | ------: | --------: | ----------: | ---------: |
| mount後    |        653,196 | 534,180 | 1,801,900 |       1.22x |      0.36x |
| 1件更新後  |        675,208 | 550,344 | 2,757,972 |       1.23x |      0.24x |
| 全件削除後 |        176,568 | 176,020 |   972,428 |       1.00x |      0.18x |
| 解放処理後 |        171,384 | 174,804 |   805,312 |       0.98x |      0.21x |

これはV8のJavaScriptヒープであり、native DOMのメモリを測っていない。生成版はmount後・更新後に手書き版より22〜23%多い。全件削除後と解放処理後は手書き版と同じ範囲になる。Reactの値はReactのFiber（Reactが再描画を管理する内部データ）、イベント登録、その他ReactDOMの保持分を含む。

## 生成JavaScriptの調査

compilerの`CompileResult.code`、production JavaScript、mount中の計数を使った。コード量の比較では、手書き・Reactのsource bytesは参考値であり、転送量は本番ビルド表を使う。

| 指標                   |           値 | 内容                                        |
| ---------------------- | -----------: | ------------------------------------------- |
| コンパイラ生成コード   | 10,649 bytes | minify前の`CompileResult.code`              |
| 生成初期HTML           |    378 bytes | app本体部分。Vite+のshellは1,150 bytes      |
| 関数定義               |           18 | `function name(...)`の静的計数              |
| component factory      |            2 | 条件分岐factoryとList item factory          |
| item内`__find__`呼出し |            9 | marker解決4個とイベント配線5個              |
| item内イベント登録     |            5 | itemごとに生成                              |
| top-levelイベント登録  |            8 | mount/hydrateへ同じ4行を各1回出力           |
| template初期化         |            4 | mount/hydrateへ同じ2個を各1回出力           |
| `visibleTodos`代入     |            3 | 初期化、`update_filter()`、`update_todos()` |
| active count式         |            2 | 初期化と`update_todos()`                    |
| item binding           |            4 | text 1、属性3                               |
| range探索関数/呼出し   |        1 / 1 | `__findRange__`                             |

生成版がimportするruntime helperは`mountWithRanges`、`hydrateWithRanges`、`createListRuntime`、`reconcileList`、`updateListBinding`である。生成production JavaScriptにcompiler本体は含まれず、未使用helperのimportはこのfixtureでは見つからなかった。

生成コードには次の重複がある。

- `mount()`と`hydrateComponentInstance()`がtemplate作成、top-level listener登録、`update_filter()`、`update_todos()`を同じ形で持つ。
- `update_filter()`と`update_todos()`が`visibleTodos`の再計算と条件分岐のList reconcileを持つ。`update_todos()`にはactive count反映もある。
- item factoryはmarker参照を`__m1__`、`__m2__`、`__m3__`、`__m5__`へ保存する一方、イベント登録では同じ対象を`__find__`で再探索する。`m4`は保存せずclick配線で探索する。
- List更新は各更新でvisible配列を走査し、runtimeのkey Mapとitemごとのbinding Mapを照合する。現在のTodoMVC sourceは`collection.update()`ではなく配列全体のsetterを使うため、1件変更でもこのList経路を通る。
- authored `TodoItem`は実行時componentとして出荷されず、`__create_m6__`のitem factoryへinlineされる。itemごとのローカル`editing`状態、marker解決、5個のイベント配線、4個のbinding更新がこのfactoryのクロージャへ入る。
- 手書き版にない処理として、生成版はmarker Mapの構築、範囲anchorの再帰探索、`updateListBinding()`によるbinding Mapの比較を行う。`__findRange__`の定義と呼出しは1個ずつである。

## 判定

| 分類                             | 判定     | 根拠                                                                                                        |
| -------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| 現在の出力でコストが集中する箇所 | 初期化   | N=10,000で生成版441.3ms。5Nリスナー、8N探索、template clone、List reconcileが同じmountに入る                |
| compilerで削減できる重複         | あり     | mount/hydrateの同一配線、`visibleTodos`再計算、item内`__find__`再探索                                       |
| runtimeで削減できる候補          | 条件付き | 配列setterのList全体走査は`collection.update()`の直接通知へ移せるが、現在のauthoringはそのAPIを使っていない |
| 意味論として必要                 | あり     | keyed identity、item local state、bindingの`Object.is`判定、DOM範囲anchor、各操作のイベント契約             |

runtimeのkey Mapとbinding Mapは、keyed再利用、追加・削除・並べ替え、変更bindingだけのDOM反映を成立させるため、単純削除の対象ではない。手書き版の全件再appendを生成版へ移すことも、観測したDOM範囲の利点を失うため採用しない。

## 次の最適化

item factoryのmarker参照をイベント配線へ再利用する最適化を1件目とする。現在は`m1`、`m2`、`m3`を解決した後に同じ対象を再び`__find__`し、`m4`も別に探索する。生成器が`m4`を含む参照を1回だけ解決し、5個のリスナーを保存済み参照へ配線すれば、mount内部の`querySelector`は実測8Nから4Nになる見込みである。この4Nは未実装・未計測の予測値であり、変更後に同じ計測を再実行する。

## 制約と追加確認

- これは1台のNixOS Chromiumでの相対比較である。絶対時間はCPU、Chromium、負荷に依存する。
- `MutationObserver`はDOM APIの操作記録であり、paint、layout、compositeの時間ではない。
- JavaScriptヒープはnative DOMメモリを含まず、解放処理後に残るReact内部の保持理由までは分解していない。手書き版はcontainer除去であり、instanceのunmount計測ではない。
- 生成版と手書き版のフィルタ時のitem handle保持が異なる。編集開始後のフィルタ切り替え、空フィルタ、再表示後のlocal stateを追加試験する必要がある。
- reorderは現行TodoMVC fixtureに操作がない。並べ替えを評価する場合は、同じ機能を持つ比較fixtureを追加してから測る。
- 次の最適化後は、初期化時間、`querySelector`回数、リスナー数、編集・削除の機能試験を再確認する。
