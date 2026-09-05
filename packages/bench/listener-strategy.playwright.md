# List itemイベント配線方式のブラウザ計測

List item内の操作要素へ直接リスナーを付ける方式と、親要素へリスナーを付けて
`closest()`と`Map`で対象を引く方式を、同じDOM・同じハンドラ本体で比較する。
`capture`は親の捕捉リスナー、`adapter`は親リスナーと`Proxy`による
`currentTarget`補正を表す。計測対象は次の6イベントである。

`click`、`change`、`input`、`keydown`、`dblclick`、`blur`。

## 実行条件

2026-09-05、NixOS Chromium 152.0.7977.75、Node v24.20.0、Linux x86_64で実行した。
各時間値は7回の中央値、ヒープ値は3回の中央値である。各itemについて6イベントを
1回ずつ発生させた。dispatchはイベント処理の計時だけで、通常のユーザー操作1回の
遅延を表す値ではない。

```sh
IRISOUT_BENCH_LISTENER_SIZES=100,1000,10000 \
IRISOUT_BENCH_LISTENER_REPEATS=7 \
IRISOUT_BENCH_LISTENER_HEAP_REPEATS=3 \
IRISOUT_BENCH_LISTENER_DISPATCH_ROUNDS=1 \
  bun run bench:listener-strategy
```

fixtureの各itemは、子`span`を持つclick/dblclick用button、checkbox、text inputを
持つ。直接方式は各操作要素へ6個のリスナーを登録する。ほかの3方式はrootへ
イベント種別ごとのリスナーを6個登録し、item identityの`Map`を保持する。
Mapの構築・保持はmount、attach、ヒープの計測へ含めた。

## bundle

これは方式比較fixtureをminifyした値であり、compilerの本番出力差ではない。

| 方式      | minify後 |    gzip |
| --------- | -------: | ------: |
| direct    |  4,769 B | 1,625 B |
| delegated |  5,306 B | 1,849 B |
| capture   |  5,306 B | 1,848 B |
| adapter   |  5,306 B | 1,849 B |

## 時間とリスナー数

単位はms。mountはDOM生成と配線、attachは配線だけ、dispatchは6Nイベントの処理で
ある。直接方式のリスナー数は`6N`、ほかは6個である。

|      N | 指標     | direct | delegated | capture | adapter |
| -----: | -------- | -----: | --------: | ------: | ------: |
|    100 | mount    |    1.4 |       1.3 |     1.3 |     1.5 |
|    100 | attach   |    0.3 |       0.1 |     0.1 |     0.0 |
|    100 | dispatch |    1.6 |       1.5 |     1.6 |     2.1 |
|  1,000 | mount    |   13.2 |      12.3 |    11.1 |    11.7 |
|  1,000 | attach   |    2.8 |       0.7 |     0.4 |     0.7 |
|  1,000 | dispatch |   16.2 |      16.9 |    17.3 |    18.9 |
| 10,000 | mount    |  133.5 |     102.3 |   100.3 |   102.7 |
| 10,000 | attach   |   24.0 |       3.3 |     4.1 |     4.7 |
| 10,000 | dispatch |  139.8 |     146.8 |   164.1 |   180.9 |

|      N | 指標                  | direct listeners | delegated listeners | capture listeners | adapter listeners |
| -----: | --------------------- | ---------------: | ------------------: | ----------------: | ----------------: |
|    100 | mount/attach/dispatch |              600 |                   6 |                 6 |                 6 |
|  1,000 | mount/attach/dispatch |            6,000 |                   6 |                 6 |                 6 |
| 10,000 | mount/attach/dispatch |           60,000 |                   6 |                 6 |                 6 |

N=10,000では、親配線のmountはdirectより23.4%短く、attachはdirectより短い。
dispatchはdirectがdelegatedより4.8%、captureより14.8%、adapterより22.7%短い。
この差は全itemへ6イベントを送ったfixtureの値である。

## JavaScriptヒープ

値は計測pageのbench driver読み込み後を基準にしたJavaScriptヒープ増分である。
DOMのnative memory、イベントリスナーのブラウザ内部保持、プロセスRSSは含まない。

|      N |      direct |   delegated |     capture |     adapter |
| -----: | ----------: | ----------: | ----------: | ----------: |
|    100 |   100,016 B |    76,972 B |    76,308 B |    76,308 B |
|  1,000 |   787,124 B |   536,524 B |   536,524 B |   536,524 B |
| 10,000 | 7,050,212 B | 4,887,600 B | 4,887,600 B | 4,887,600 B |

N=10,000では親配線3方式の値は同じで、directより30.7%少ない。ただしこの値は
fixtureの`ItemRecord`とMapを含むV8管理ヒープの値であり、DOMのメモリ量ではない。

## イベント意味論

fixtureの直接方式では、各イベントのリスナーを操作要素へ付けた。`currentTarget`
はその操作要素、`target`はdispatch元、`eventPhase`は対象要素で2となる。
数値はN件あたりの処理数で、全Nで同じ比率になった。

| 方式      | 処理数 | `currentTarget`一致 | ネイティブevent同一性 | `target`一致 | `eventPhase`            |
| --------- | -----: | ------------------: | --------------------: | -----------: | ----------------------- |
| direct    |     6N |                  6N |                    6N |           6N | click/dblclick=3、他=2  |
| delegated |     5N |                   0 |                    5N |           5N | 処理した5種=3、blur=0   |
| capture   |     6N |                   0 |                    6N |           6N | 全種=1                  |
| adapter   |     6N |                  6N |                     0 |           6N | bubbleする5種=3、blur=1 |

委譲方式は`blur`をrootの通常リスナーで受けられない。`blur`はバブルしないためで
ある。capture方式は全イベントを受けるが、親要素で捕捉するので`currentTarget`と
`eventPhase`が変わる。adapter方式は`Proxy`で`currentTarget`を補正できるが、
ハンドラが受け取るevent objectは元のネイティブeventと同一ではない。

`target`一致は、click/dblclickで子`span`をdispatch元にしたことを含めて検証した。
これは委譲が対象要素を`closest()`で引けることを示すが、`currentTarget`の意味を
直接方式と同じにすることは示さない。

## production方式の決定

productionの既定方式は直接配線を維持する。理由は、現在のcompilerが渡している
ネイティブeventの次の契約を、四方式のうち直接方式だけが全イベントで保つためである。

- `currentTarget`がリスナーを付けた操作要素である。
- `target`とevent objectの同一性が保たれる。
- bubbling、捕捉、対象要素の`eventPhase`がブラウザの配線どおりである。
- `blur`を個別リスナーで処理できる。

委譲、capture、adapterのmount・attach・ヒープ上の差は確認したが、意味論の差を
補う実装をcompiler/runtimeへ追加する根拠にはしない。N閾値による自動切り替え、
公開イベント委譲API、captureへの個別fallbackは追加しない。別のイベント契約または
実アプリで直接配線の保持コストが問題になった場合は、そのfixtureの意味論と
ライフサイクルを含めて再計測する。

## 限界

- 単一Chromium・単一Linux環境の中央値である。
- 時間はDOM生成、Map lookup、イベント生成、イベント経路を含むが、layout/paintを
  含まない。
- item削除、keyed再利用、再挿入後のMap更新はこの方式fixtureでは測っていない。
  productionへ委譲を導入する場合は、List runtimeの生存期間と同じ試験が必要になる。
- adapterは`Proxy`による比較用の補正であり、ブラウザのevent objectの全プロパティや
  readonly契約を等価にする実装ではない。
