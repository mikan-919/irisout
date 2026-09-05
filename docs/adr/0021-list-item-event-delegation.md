# ADR-0021: List itemイベント配線を実ブラウザで比較し、直接配線を採用

## ステータス

**決定済み・直接配線をproduction既定として維持**(2026-09-05)。比較用の
委譲・捕捉・adapter実装はbenchに残すが、compiler/runtimeのproduction配線は
変更しない。

## コンテキスト

ADR-0005は、keyed reuseしたList itemの操作要素へ直接`addEventListener`を付ける
方式を採用した。旧`packages/bench/listener-strategy.ts`はjsdom上のclick比較で、
実ブラウザのイベント経路と`currentTarget`を検証していなかった。

現行compiler/runtimeはauthoringのevent objectをネイティブeventとしてhandlerへ渡す。
そのため、`event.target`、`event.currentTarget`、イベント同一性、バブル・捕捉、
`blur`の非バブル性は意味保存の対象になる。TodoMVCの編集inputには`keydown`と`blur`が
あり、単一のbubbling clickだけで配線方式を決めることはできない。

## 決定

### 1. 四方式を同じfixtureで比較する

`packages/bench/listener-strategy.playwright.ts`は、次の方式を実Chromiumで比較する。

- `direct`: 各操作要素へ直接リスナーを付ける。
- `delegated`: rootのバブルリスナーで`closest()`と`Map`から対象を引く。
- `capture`: rootの捕捉リスナーで対象を引く。
- `adapter`: rootリスナーで対象を引き、比較用`Proxy`で`currentTarget`を補正する。

fixtureは子`span`付きのclick/dblclick button、checkbox、text inputを持ち、
`click`、`change`、`input`、`keydown`、`dblclick`、`blur`を各itemへ送る。
item identityのMap構築・保持はmount、attach、ヒープへ含める。

### 2. 計測結果

2026-09-05、Chromium 152.0.7977.75、Linux x86_64、7回の時間中央値、3回の
JavaScriptヒープ中央値を測った。

|      N | 指標     |   direct | delegated |  capture |  adapter |
| -----: | -------- | -------: | --------: | -------: | -------: |
|    100 | mount    |   1.4 ms |    1.3 ms |   1.3 ms |   1.5 ms |
|    100 | attach   |   0.3 ms |    0.1 ms |   0.1 ms |   0.0 ms |
|    100 | dispatch |   1.6 ms |    1.5 ms |   1.6 ms |   2.1 ms |
|  1,000 | mount    |  13.2 ms |   12.3 ms |  11.1 ms |  11.7 ms |
|  1,000 | attach   |   2.8 ms |    0.7 ms |   0.4 ms |   0.7 ms |
|  1,000 | dispatch |  16.2 ms |   16.9 ms |  17.3 ms |  18.9 ms |
| 10,000 | mount    | 133.5 ms |  102.3 ms | 100.3 ms | 102.7 ms |
| 10,000 | attach   |  24.0 ms |    3.3 ms |   4.1 ms |   4.7 ms |
| 10,000 | dispatch | 139.8 ms |  146.8 ms | 164.1 ms | 180.9 ms |

N=10,000のretained JavaScriptヒープは、direct 7,050,212 B、delegated/capture/
adapter 4,887,600 Bだった。bundleはdirect 4,769 B gzip 1,625 B、ほか3方式は
gzip 1,848〜1,849 Bだった。ヒープはJavaScript管理領域の計測であり、DOMのnative
memoryを含まない。

### 3. 意味論の結果

| 方式      | 処理数 | `currentTarget`一致 | event同一性 | `target`一致 | 段階                    |
| --------- | -----: | ------------------: | ----------: | -----------: | ----------------------- |
| direct    |     6N |                  6N |          6N |           6N | click/dblclick=3、他=2  |
| delegated |     5N |                   0 |          5N |           5N | 処理した5種=3、blur=0   |
| capture   |     6N |                   0 |          6N |           6N | 全種=1                  |
| adapter   |     6N |                  6N |           0 |           6N | bubbleする5種=3、blur=1 |

`blur`はバブルしないため、delegatedのrootバブルリスナーには届かない。captureは
全イベントを処理できるが、`currentTarget`とイベント段階が変わる。adapterは
`currentTarget`を補正できるが、handlerへ渡すobjectが元のネイティブeventと同一で
なくなる。click/dblclickでは子`span`をtargetにして`target`の一致も確認した。

### 4. production方式

productionの既定方式は`direct`を維持する。直接方式だけが、全6イベントで
`currentTarget`、ネイティブevent同一性、`target`、バブル・捕捉の段階、`blur`処理を
同時に保った。委譲方式のmount、attach、ヒープ上の利点は確認したが、意味論を変える
代償をcompiler/runtimeへ追加する根拠にはしない。

N閾値による自動切り替え、公開イベント委譲API、captureへの個別fallbackは追加しない。
実アプリで直接配線の保持コストが問題になり、イベント契約を変更できる場合だけ、
そのアプリのkeyed再利用・削除・再挿入・ライフサイクルを含めて別計測する。

## 対象外

- production compiler/runtimeの委譲実装。
- `focusout`など別イベントへの置換。
- Listのkeyed diffと同じ生存期間を持つ委譲帳簿の実装。
- DOM/native memory、イベントリスナーのブラウザ内部保持、RSS、layout、paint。
- 他ブラウザやGUI環境への絶対値の外挿。

## 結果

- 直接配線をproduction既定として維持する。
- 委譲はclick相当の速度・ヒープでは有利だが、`blur`、`currentTarget`、event同一性
  の差があるため、全イベントの既定方式には採用しない。
- 計測条件と値は`packages/bench/listener-strategy.playwright.md`へ記録した。
