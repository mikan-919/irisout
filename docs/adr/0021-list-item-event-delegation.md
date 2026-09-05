# ADR-0021: List itemイベント委譲をclick相当で評価し、production採用を保留する

## ステータス

**測定済み・production判断保留**(2026-09-05)。このADRはclick相当の測定範囲と
次の設計作業を記録するものであり、今回のベンチマークではproduction compiler/
runtimeを変更しない。

## コンテキスト

ADR-0005は、keyed reuseしたList itemへ直接`addEventListener`を貼る方式を採用した。
当時の`bench/listener-strategy.ts`はjsdom上の比較で、attach以外は直接方式と委譲方式が
ほぼ互角に見えた。TodoMVCの実Chromium再計測でjsdomと速度結論が逆転したため、
イベント配線も実ブラウザで比較する必要があった。特に、委譲方式は`event.target`から
item identityとhandler semanticsを引く帳簿コストを持つので、親リスナー1個だけの
簡略fixtureでは比較しない。

ただし現行のcompiler/runtimeは、sourceに書かれたnative eventをそのまま直接listener
へ渡す。`render.ts`は`onXxx`を小文字化して`click`、`change`、`input`、`keydown`、
`dblclick`、`blur`等へ変換し、`codegen.ts`はroot・List item factory・conditional
factoryの全てでoptionsなしの`addEventListener`を生成する。handlerが観測できる
`event.target`/`event.currentTarget`とbubbling/captureは、ADR-0004の意味保存境界に
含まれる。特にTodoMVCとsame-file component testにはList item内の`onBlur`があり、
`blur`は通常bubbleしない。また直接listenerでは`currentTarget`がitem要素だが、
親委譲ではrootへ変わる。

このため今回のfixtureが比較できるのは、子`span`をtargetにしたbubbling `click`で、
ハンドラへ正しいitem identityを渡す部分までである。native `currentTarget`互換や
non-bubbling eventを解決した意味同等性は測っていない。

## 決定

### 1. bubblingするclick相当ではイベント委譲を有望な候補とする

List rootにイベントリスナーを置き、item要素を`closest()`等で特定した後、keyから
item handle/handlerへ到達する方式は、bubblingするclick相当について有望な候補とする。
item identityの帳簿はListのkeyed reuse・削除・再挿入と同じ生存期間で更新し、未知の
要素やroot外へバブルしたイベントは無視する。

この候補評価は、`packages/bench/listener-strategy.playwright.md`の実Chromium測定に基づく。
同じDOM、同じ`ItemRecord`、同じハンドラ本体を使い、委譲側の
`Map<HTMLButtonElement, ItemRecord>`をattach/mount/heapへ含めた。

これは全イベントのproduction採用を決めない。`blur`などnon-bubbling eventには
capture/direct配線等の別設計が必要で、native `currentTarget`をitem要素と同じに
保てるproxy/adapterも、event identityやreadonly性を壊さないか検証していない。

### 2. 採否の根拠

2026-09-05、Chromium 152.0.7977.75、Linux x86_64で次を測定した。

|       N | mount direct/delegated | attach direct/delegated | dispatch direct/delegated | JS heap direct/delegated |
| ------: | ---------------------: | ----------------------: | ------------------------: | -----------------------: |
|  10,000 |         36.5 / 30.7 ms |            2.7 / 0.7 ms |            32.5 / 35.1 ms |    1,035,344 / 785,020 B |
| 100,000 |       405.2 / 317.0 ms |           42.8 / 5.1 ms |          355.8 / 389.3 ms |  9,963,952 / 7,599,192 B |

委譲はN=10,000/100,000でmount、attach、retained JS heapが有利だった。dispatchは
直接方式が約7〜9%速いが、全itemへ機械的にイベントを送る比較であり、通常のユーザー
クリック1回の差を意味しない。委譲bundleは直接方式よりraw +239B、gzip +121Bである。
ただしこれはclick相当の候補評価であり、currentTargetと複数event semanticsを含む
production採否の根拠にはしない。bundle値もこの比較fixtureを方式別にminifyした値で、
現行compilerが生成するproduction bundleの差分ではない。

### 3. production判断を保留する範囲

現在のproduction配線(直接`addEventListener`)を変更しない。実行時にN閾値で方式を
切り替える公開APIも追加しない。次の設計作業では、実生成に近い複数event fixtureで
既存handler semanticsを固定し、代表的な代替方式を測定してからADRを改訂する。

## 対象外

- 今回のproduction compiler/runtime実装、公開イベント委譲API、動的なN閾値。
- click以外のevent semantics、capture/direct fallback、`event.currentTarget`を
  保持するproxy/adapter。
- Listのkeyed diff、virtualization、handler closure以外のアプリ固有リソース管理。
- DOM/native memory、EventListenerのbrowser-internal memory、Chromium RSS、layout/paint。
- 他ブラウザ、GUIモード、低メモリ端末の絶対値への外挿。

## 結果

- 旧jsdom測定だけで直接方式を維持する根拠は、bubblingするclick相当について更新された。
- production配線は直接方式を維持し、委譲はcurrentTarget互換とnon-bubbling eventを
  解決できた場合の候補として保留する。
- 次の最小作業は、実生成に近い`click`/`change`/`input`/`keydown`/`dblclick`/
  `blur` fixtureを作り、direct、capture、focusout等の代替、proxy/adapterの
  currentTarget semantics、item帳簿更新を測定することである。
- collectionの構造操作APIは本ADRの対象外であり、実需と別ベンチマークが出るまで保留する。
