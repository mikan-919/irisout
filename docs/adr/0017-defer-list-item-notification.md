# ADR-0017: List変更itemの直接通知は通知元APIまで導入しない

## ステータス

**決定済み・比較fixture実装済み**(2026-09-04)。延期条件だったkeyed collection APIを
ADR-0019で決定・実装し、製品runtimeへ導入済み。

## コンテキスト

ADR-0015のaddressed List runtimeは、値が変化したbindingだけをDOMへ書き込み、
順序が同じitemを再挿入しない。一方、配列signalが更新されるたびに全keyを走査し、
全itemの`handle.update()`を呼ぶため、1件だけの変更もO(N)になる。

`packages/bench/list-runtime.playwright.ts`へ、呼び出し側が変更item IDを既に知っている
`direct`方式を追加した。値だけの変更は`runtime.items.get(itemId)`からhandleを直接更新し、
append、remove、reverseなどの構造変更は従来どおり`reconcileList()`する。

Chromium 151、NixOS/WSL2で同一itemを100回交互更新した中央値は次のとおり。

| item数 | addressed / 更新 | direct / 更新 | addressed / direct |
| -----: | ---------------: | ------------: | -----------------: |
|    100 |          0.012ms |       0.001ms |             12.00x |
|  1,000 |          0.072ms |       0.001ms |             72.00x |
| 10,000 |          0.870ms |       0.001ms |            870.00x |

1µsという値自体はブラウザtimer分解能に近く、正確なレイテンシではない。ただし、directの
時間がitem数に比例せず、key全走査を省く効果は明確である。比較fixtureの追加コストは
addressed比でraw +199B、gzip +50B、N=10,000 mount後のretained JS heap差は+536Bだった。
構造変更ではaddressedと同じreconcile経路を使い、一貫した性能悪化は見られなかった。

しかし現行authoring APIは`items(nextArray)`という配列全体のsetterだけである。新旧配列から
変更item IDをruntimeが発見するには結局key走査が必要で、直接通知の利点が消える。コンパイラが
一般の`map()`、`slice()`、spread、関数呼び出しを解析して変更IDを推測する方式も、対応構文と
意味論を複雑にする。

## 決定

直接通知の実行機構が有効であることは採用候補として固定するが、現行の配列setterの裏側へは
追加しない。変更item IDを作者またはコンパイラが曖昧さなく供給できるcollection更新APIを
設計するときに、次の2経路をセットで導入する。

- 値だけの変更: listId / itemIdから既存handleを直接更新する
- key集合または順序の変更: `reconcileList()`で構造を更新する

この延期条件はADR-0019の`collection(initial, keyOf)`と`collection.update(key, updater)`で
満たされた。通常setterは`reconcileList()`を維持し、`collection.update()`だけがbenchmarkの
`direct`と同型のhandle直接更新を使う。

## 検討した代替案

### 配列setterのたびにruntimeが変更itemを探索する

却下。全key走査が残り、今回確認したO(1)の通知経路にならない。

### `map()`などの配列式からコンパイラが変更itemを推測する

却下。任意のcalleeや条件分岐を含むJavaScriptで完全には判定できず、最適化の成否によって
性能モデルが変わる。irisoutのコンパイラ境界を性能最適化のために拡大しすぎる。

### 直ちにcollection専用のauthoring APIを追加する

延期。直接通知の性能根拠は得られたが、更新、追加、削除、並べ替え、複数変更を表すAPIと
既存signalとの関係は未設計である。イベント委譲や更新バッチより先に公開構文を増やさない。

## 結果

- 直接通知の速度、bundle、heapの比較基準が残る。
- 現行APIの意味を変えず、推測ベースの複雑なコンパイラ最適化を避ける。
- 変更item IDを明示するcollection更新APIをADR-0019で導入し、製品経路でもO(1)通知を利用できる。
