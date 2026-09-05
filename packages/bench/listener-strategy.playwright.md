# List item event listener strategy browser benchmark

List itemごとの直接`addEventListener`と、親要素1つへのイベント委譲を、同じDOM
fixture・同じアイテムハンドラ意味論で実Chromium上で比較する。旧来の
`listener-strategy.ts`(jsdom)は履歴比較用に残し、イベント配線の採否はこの
Playwright版を根拠にする(`ADR-0021`)。ただしこのrunnerが実証するのは、
bubblingする`click`相当でitem identityを解決する候補比較までである。

## 実行

通常のpackage scriptから再現できる。

```bash
bun run bench:listener-strategy
```

NixOSではrunnerが`nixpkgs#chromium`を解決する。別のChromiumを明示する場合:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v chromium) \
  bun run bench:listener-strategy
```

短縮実行・再計測は環境変数で指定する。

```bash
IRISOUT_BENCH_LISTENER_SIZES=100,1000 \
IRISOUT_BENCH_LISTENER_REPEATS=3 \
IRISOUT_BENCH_LISTENER_HEAP_REPEATS=2 \
IRISOUT_BENCH_LISTENER_DISPATCH_ROUNDS=2 \
  bun run bench:listener-strategy
```

既定値は`sizes=100,1000,10000`、時間7回、heap3回、各itemを1回dispatchする。
各時間計測はwarm-upを1回捨て、残りの中央値を出す。heapは方式ごとに毎回新しい
pageを作り、CDPの`HeapProfiler.collectGarbage`後の`Runtime.getHeapUsage`を
ベースラインとの差分として測り、反復中央値を出す。

## fixtureと公平性

- 直接方式は各buttonにitem identityを閉じ込めたリスナーを1つ登録する。
- 委譲方式はrootにリスナーを1つ登録し、子`span`をevent targetにしたclickを
  `closest()`でbuttonへ戻してから、`Map<HTMLButtonElement, ItemRecord>`で
  item identityとハンドラ対象を引く。
- 両方式とも同じ`ItemRecord`・同じ`runItemHandler(record, event)`を使い、
  itemごとのhandled数とidentity checksumを更新する。従って委譲方式に必要な
  identity帳簿(Map)の構築・保持をattach/mount/heapへ含めている。
- dispatchの全itemで`eventCount`、`handledCount`、`identityChecksum`が一致
  することをrunnerが検証する。
- mountはDOM生成と配線、attachはDOM生成後の配線だけ、dispatchは配線済みfixture
  のイベント処理だけを時間区間にする。
- dispatchする`MouseEvent('click')`は`bubbles: true`で、targetはbutton内の
  `span`である。直接方式ではnative `event.currentTarget`がbutton、委譲方式では
  rootになる。directの`event.currentTarget`を業務意味論に使うfixtureではなく、
  event object identity/currentTargetを同値化するproxy/adapterも入れていないため、
  両方式が同じitem identityをハンドラへ渡す契約だけを比較している。
- `blur`などnon-bubbling event、capture listener、`change`/`input`/`keydown`/
  `dblclick`のevent semanticsはこのrunnerの対象外である。現行compiler/runtimeが
  native eventを直接渡す意味を保てるかはADR-0021の次の保留作業で検証する。

## 初回実測

2026-09-05、Chromium 152.0.7977.75 (headless、NixOS Chromium、Linux x86_64、
Node v24.19.0)で、`REPEATS=7`、`HEAP_REPEATS=3`、`DISPATCH_ROUNDS=1`を実行した。
表中の時間は`direct / delegated`のms中央値、heapはretained JS heap bytesの
中央値である。

|        N |   mount ms    | attach ms  |  dispatch ms  |      retained JS heap |
| -------: | :-----------: | :--------: | :-----------: | --------------------: |
|      100 |   0.5 / 0.4   | 0.1 / 0.0  |   0.4 / 0.4   |       24,652 / 21,392 |
|    1,000 |   3.2 / 3.0   | 0.3 / 0.0  |   4.2 / 3.9   |     218,256 / 184,812 |
|   10,000 |  36.5 / 30.7  | 2.7 / 0.7  |  32.5 / 35.1  |   1,035,344 / 785,020 |
| 100,000* | 405.2 / 317.0 | 42.8 / 5.1 | 355.8 / 389.3 | 9,963,952 / 7,599,192 |

`*` N=100,000は`REPEATS=3`、`HEAP_REPEATS=2`の追加確認。attachはN=100/1,000
ではChromium timerの分解能以下に丸められる反復があるため、0.0はゼロコストを
意味しない。

bundleは方式別にこの比較fixtureをminifyして次の差だった。現行compilerが生成する
production bundleの差分ではない。

| 方式      | minified |    gzip |
| --------- | -------: | ------: |
| direct    |  2,395 B |   949 B |
| delegated |  2,634 B | 1,070 B |

全サイズで意味論の検証は一致した。N=10,000では委譲がmount 16%、attach 3.86倍、
retained JS heap 24%小さく、dispatchだけ直接方式が約7%速い。N=100,000でも同じ
傾向で、委譲はmount 22%、attach 8.39倍、retained JS heap 24%小さく、dispatchは
直接方式が約9%速い。委譲の帳簿(Map)込みでも、今回のChromiumでは直接方式の
itemごとのクロージャの方がJS heapを多く保持した。

## 測定結果の範囲と判断

ADR-0021では、bubblingするclick相当でイベント委譲を有望な候補として記録する。
mount/attachとJS heapの差は、bundle gzip +121 Bとdispatchの約7〜9%の不利を含めても
候補検討に値する。一方、native `event.currentTarget`は直接方式と一致せず、blur等の
non-bubbling eventも未評価であるため、全eventのproduction既定方式は保留する。
現行production配線は直接方式のままで、自動的なN閾値や別APIは追加しない。

このベンチマークでは本番compiler/runtimeを変更していない。次は実生成に近い
`click`/`change`/`input`/`keydown`/`dblclick`/`blur` fixtureで、direct、capture、
focusout等の代替、currentTargetを保つproxy/adapter、keyed reuse・削除/再挿入時の
帳簿更新を比較・検証する。

## 限界

- CDPのJS heapはV8のmanaged heapだけで、DOM/native memory、EventListenerの
  browser-internal memory、Chromium process RSS、レイアウト/paintコストを含まない。
- 単一のheadless Chromium・単一Linux環境の中央値であり、他ブラウザ・GUI・低メモリ
  端末へ絶対値を外挿しない。
- fixtureはitem identityをMapで引く最小の委譲帳簿を含むが、実アプリ固有の
  handler closure、List diff、仮想化、イベント種類ごとの配線数は測っていない。
- `event.currentTarget`を直接item要素と同じにする仕組みを入れていないため、
  native event semanticsを含む意味同等性の証拠ではない。
- dispatchは同じDOM内の全itemを機械的に1回ずつ処理する。ユーザーのクリック頻度や
  mount/更新比率は製品要件ではないため、この結果だけで全アプリの最適化を保証しない。
- N=100/1,000のattach値はtimer分解能の影響を受ける。設計判断はN=10,000/100,000の
  傾向を中心に行う。
