# List runtime browser benchmark

ADR-0015以前のList更新方式、現在のaddressed List runtime、変更itemを直接通知する
比較専用direct方式を同じDOM fixtureで比較する。Reactとの比較ではなく、runtime設計の
次段階を判断するための内部比較である。

## 実行

```bash
bun run bench:list-runtime
```

NixOSではPlaywright配布版Chromiumが共有ライブラリを解決できないため、runnerが
`nixpkgs#chromium`を自動解決する。初回はChromiumの取得に時間とディスク容量が必要になる。
自動判定を使わず任意のChromiumを使う場合は、実行ファイルを明示できる。

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v chromium) bun run bench:list-runtime
```

短い確認には環境変数で件数、時間計測の反復回数、heap計測の反復回数を絞れる。

```bash
IRISOUT_BENCH_SIZES=100,1000 \
IRISOUT_BENCH_REPEATS=3 \
IRISOUT_BENCH_HEAP_REPEATS=2 \
IRISOUT_BENCH_NOTIFICATION_ITERATIONS=100 \
bun run bench:list-runtime
```

## 比較対象

- `legacy`: 全keyを走査し、全itemのbindingを書き込み、全要素を`appendChild()`する。
- `addressed`: 全key走査は残るが、`Object.is()`で変化したbindingだけを書き込み、
  親または`nextSibling`が異なる要素だけを`insertBefore()`する。
- `direct`: 値だけの変更では既知のitem IDからhandleを直接引き、構造変更だけ
  `reconcileList()`する比較専用方式。

3方式とも同じ`ul`/`li`、同じkey、同じ更新後配列を使う。配列生成は計測区間の外で行い、
List reconciliationとDOM反映だけを測る。`direct`は呼び出し側が変更item IDを既に知る
場合の上限比較であり、現行の配列setterからIDを発見するコストは含まない。

## シナリオ

- mount
- 1件だけbinding更新
- 末尾へ1件追加
- 末尾から1件削除
- 全順序をreverse
- 全件のbinding更新
- 同一itemを交互に既定100回更新(addressed/directのみ、1更新あたりの時間を算出)

各セルはウォームアップ1回を捨て、既定7回の時間中央値を出す。時間に加えて
`MutationObserver`のrecord数を出し、最適化が実DOM操作を減らしたかも確認する。

bundle sizeは方式ごとに独立entryをminifyし、raw byteとgzip byteを出す。heapは
各方式を別pageでmountまたは更新し、CDPで強制GCした後のretained JS heap増分を
既定3回の中央値で出す。DOM側のnative memoryやbrowser process全体のRSSは含まない。
出力末尾のJSONは後続の結果記録や可視化に利用できる。

## 初回実測

2026-09-04、Chromium 151 headless、NixOS/WSL2で既定設定を実行した。N=10,000の
中央値は次のとおり。単一環境の初回値であり、設計決定の最終結果ではない。

| scenario  | legacy | addressed | legacy / addressed | mutations (legacy → addressed) |
| --------- | -----: | --------: | -----------------: | -----------------------------: |
| mount     |  9.3ms |    11.1ms |              0.84x |                          0 → 0 |
| updateOne | 29.0ms |     2.1ms |             13.81x |                     30,000 → 1 |
| appendOne | 27.8ms |     1.2ms |             23.17x |                     30,001 → 1 |
| removeOne | 27.7ms |     1.1ms |             25.18x |                     29,998 → 1 |
| reverse   | 28.6ms |    16.8ms |              1.70x |                30,000 → 19,998 |
| updateAll | 29.1ms |    13.6ms |              2.14x |                30,000 → 10,000 |

現行方式がDOM mutationを意図どおり削減することは確認できた。一方、addressed方式も
全key走査を続けるため、1件更新はN=1,000の0.2msからN=10,000の1.2msへ増える。
変更itemの直接通知を検討する際の比較基準として使う。

direct比較追加後の独立fixture bundleはlegacy 3,225B / gzip 1,124B、addressed
4,213B / gzip 1,541B、direct 4,412B / gzip 1,591Bだった。directのaddressed比はraw +199B、
gzip +50B。N=10,000 mount後のretained JS heapはlegacy 1,165,260B、addressed
2,783,232B、direct 2,783,768Bで、direct追加分は計測上ほぼ無い。

既定100回の同一item更新では、1更新あたりaddressed / directがN=100で
0.012ms / 0.001ms、N=1,000で0.072ms / 0.001ms、N=10,000で0.870ms / 0.001msだった。
direct値は100回合計でもブラウザtimer分解能に近いため、正確な1µsレイテンシではなく、
件数に比例するkey走査が消えたことを示す値として扱う。append/remove/reverseは従来の
reconcileを使うため、addressedから一貫した速度・mutation・heapの悪化は見られなかった。

## 現時点で測らないもの

- 現行の配列setterから変更item IDを通知するauthoring/runtime API
- microtask更新バッチ
- List itemイベント委譲(専用fixtureは`listener-strategy.playwright.md`で測定済み。
  bubblingするclick相当以外のproduction採否はADR-0021で保留)
- DOM native memoryとbrowser process全体のRSS

retained JS heapは実行間の揺れがあるため絶対値ではなく、同一実行内の方式間比較に使う。
このbenchmark単独の数値だけで次のruntime APIを決定しない。
