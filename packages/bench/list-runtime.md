# List runtime browser benchmark

ADR-0015以前のList更新方式と、現在のaddressed List runtimeを同じDOM fixtureで比較する。
Reactとの比較ではなく、runtime設計の次段階を判断するための内部比較である。

## 実行

```bash
bun run bench:list-runtime
```

NixOSなどPlaywright配布版のChromiumを直接起動できない環境では、system Chromiumを
指定できる。

```bash
nix shell nixpkgs#chromium --command sh -c \
  'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v chromium) bun run bench:list-runtime'
```

短い確認には環境変数で件数と反復回数を絞れる。

```bash
IRISOUT_BENCH_SIZES=100,1000 IRISOUT_BENCH_REPEATS=3 bun run bench:list-runtime
```

## 比較対象

- `legacy`: 全keyを走査し、全itemのbindingを書き込み、全要素を`appendChild()`する。
- `addressed`: 全key走査は残るが、`Object.is()`で変化したbindingだけを書き込み、
  親または`nextSibling`が異なる要素だけを`insertBefore()`する。

両者とも同じ`ul`/`li`、同じkey、同じ更新後配列を使う。配列生成は計測区間の外で行い、
List reconciliationとDOM反映だけを測る。

## シナリオ

- mount
- 1件だけbinding更新
- 末尾へ1件追加
- 末尾から1件削除
- 全順序をreverse
- 全件のbinding更新

各セルはウォームアップ1回を捨て、既定7回の中央値を出す。時間に加えて
`MutationObserver`のrecord数を出し、最適化が実DOM操作を減らしたかも確認する。
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
全key走査を続けるため、1件更新はN=1,000の0.2msからN=10,000の1.3msへ増える。
変更itemの直接通知を検討する際の比較基準として使う。

## 現時点で測らないもの

- 変更itemの直接通知(key全走査を省く案はまだ未実装)
- microtask更新バッチ
- イベント委譲
- ブラウザheap

heap比較はGCタイミングを固定できる専用fixtureと測定方法を決めてから追加する。
このbenchmark単独の数値だけで次のruntime APIを決定しない。
