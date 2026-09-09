# ADR-0045: リスト項目の初期条件分岐DOM再利用

## ステータス

**決定済み・限定採用、ADR-0046でR3完了**(2026-09-09)

## 背景

リスト項目内の条件分岐は、項目factoryがroot要素をcloneし、初回updateで条件を評価し、
選択枝をrangeへ挿入する。TodoMVCの編集状態では、各項目のローカルsignalが`false`で
始まり、非編集枝が全項目で同じである。この場合、項目templateへ非編集枝を含めても
条件の評価結果は変わらず、初回のbranch cloneとDOM挿入を省ける。

一方、条件式が項目値を読む場合は項目ごとに選択枝が異なり得る。条件式や初期値に
副作用がある場合は評価回数・順序を変えてはならない。branch内の入れ子構造、action、
onMount、effect、SVGでは、DOM接続順序や破棄順序を変えないことが必要である。

## 決定

- リスト項目のfactoryが直接所有するローカルsignalについて、条件式がそのsignal名と
  一致し、初期化式が`true`または`false`のときだけ初期枝の再利用を検討する。
- 選択枝がライフサイクル、入れ子構造、ローカルsignal、SVGを含む場合、または
  条件rangeがSVG名前空間内にある場合は対象外とし、既存の
  `template.content.cloneNode(true)`経路を使う。
- 対象枝のDOMはリスト項目templateの条件分岐range内へ含める。初回updateはrange内の
  要素をbranch factoryへ渡し、branch factoryはその要素のmarker探索、binding初期化、
  直接イベント登録を一度だけ実行する。
- 条件分岐の初回引き取りフラグは一度だけ消費する。初回以後の枝切替、同じ枝の更新、
  keyed reuse、binding cacheの生成・破棄は既存経路を使う。既存要素がrangeの末尾に
  ある場合は再挿入せず、対象外の通常clone経路では従来どおり挿入する。
- 条件評価の対象を広げる一般化、親へのイベント委譲、action/lifecycle registryの
  追加は行わない。

## 結果

初期枝のcloneと挿入を項目ごとに一度ずつ省く候補を、TodoMVCの編集枝へ限定適用する。
初期値が項目ごとに異なる条件、lifecycle付き・入れ子・SVGの条件は既存経路へ残る。
直接イベント登録、条件枝の状態保持、非表示後の再表示、hydrate、追加・並べ替え・削除を
回帰試験で確認した。

変更前コミット`e645893`と最終実装を、Chromium 152.0.7977.82、同一入力、予熱3回、
15回の中央値、初期focus除外、N=100/1000/10000で比較した。最終比較では生成版mountが
N=10000で旧86.6ms、実装74.0ms、14.5%短縮だった。N=100/1000は旧0.9/8.9ms、
実装1.0/8.1msである。同条件の前回候補計測は旧78.3ms、候補74.7msで4.6%短縮だった。
環境ばらつきがあるため20%短縮は未達成とし、旧82.7msの過去記録とは比較していない。
通常更新のN=10000は旧3.5/3.5/3.6/3.4/62.4ms、実装3.4/3.4/3.2/3.3/50.5ms
(toggle/text/add/remove/filter)だった。転送量は生成JavaScript 8293B(2733 gzip)から
8498B(2807 gzip)、N=1000のmount heapは926800Bから932556Bへ変化した。
限定適用は正しさと初期化短縮の根拠があるため採用する。20%には届かなかったが、
ADR-0046で固定目標を改訂し、R3を完了した。
生データは`/tmp/irisout-r3-adoption-old-e645893-final-20260908.json`と
`/tmp/irisout-r3-adoption-final2-20260908.json`に保存した。最終コードの初期化区間の内訳を
100回計測(予熱10回)した結果は、elapsed64.6ms、initial update63.4ms、List reconcile57.3ms、
item factory46.5ms、初期branch factory7.5msだった。内訳の生データは
`/tmp/irisout-r3-adoption-breakdown-final2-20260908.json`に保存した。

注: ここでいう「引き取り」は、templateから新しくcloneした要素ではなく、項目templateを
cloneした時点でrange内にある選択枝の要素をbranch factoryのhandleへ関連付ける処理である。
要素そのものは一つのfactory instanceだけが所有し、枝切替時に古いhandleを再利用しない。
