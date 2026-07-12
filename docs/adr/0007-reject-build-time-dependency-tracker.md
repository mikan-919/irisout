# ADR-0007: derived依存発見にquix風ビルド時トラッカーを採用しない

## ステータス

決定済み

## コンテキスト

`ROADMAP.md`の設計判断待ちの1点として、`derived`/リストの依存発見方式を
現行のBabel `scope.getBinding()`による静的解析から、`~/projects/quix`が
採用しているビルド時トラッカー方式(式を`() => expr`でラップし、ビルド時に
Node上で実際に1回実行して、実行中の読み取りを`tracker.report(id)`で観測する
方式)に切り替えるかどうかが未決定だった。`session/000_ts-rewrite-kickoff-and-m1.md`
4節は「任意の複雑な制御フローでもスコープ制限なしに依存発見できる」と記録
していたが、この判断はquixの実ソースを確認せずに書かれた推測だった。

今回、`~/projects/quix/packages/runtime/src/core/tracker.ts`の実装を確認した:

```ts
runWithScope<T>(id: string, collector: DepCollector, fn: () => T): T {
  this.stack.push({ id, collector })
  try {
    return fn()
  } finally {
    this.stack.pop()
  }
}
```

`fn()`は1回しか実行されない。分岐を全網羅する仕組みは存在しない ―
`startProbing`/`stopProbing`は`core/components/For.ts`専用(リストアイテム
テンプレートの構造発見のためのプローブ実行)であり、一般の`derived`式の
分岐カバレッジとは無関係(`core/components/Show.ts`も同様に`when`述語を
1回実行するだけ)。

## 決定

**quix風のビルド時トラッカー方式は採用しない。**

以下のように、分岐を含む式で依存を静かに見逃す(サイレントな正しさの欠落)
バグを生むため:

```js
const label = derived(() => {
  if (count() > 10) return "big" + extra();
  return "small";
});
```

ビルド時の初期状態で`count() <= 10`なら`extra()`は一度も実行されず、
`extra`への依存は発見されない。後で`count`が10を超えても`extra`の変化に
反応しない ― 実行時に気づきにくい欠落バグになる。

対して現行のBabel `scope.getBinding()`静的解析は、実行せずASTを読むため、
分岐の両方の枝に書かれた識別子を漏れなく発見する。その代償として「単一
concise arrow function式のみ」というスコープ制限があり、外れた場合は
**compile errorで安全に拒否する**(`emitDerived`のscope limit)。

ADR-0004の統治原則(ソースが要求していない実行を足さない/安全性を保つ)に
照らすと、「静かに間違える」ほうが「安全に拒否する」よりも明確に悪い。
quixの技法は既存の制限を緩めるためのものだったが、緩めた先で新しい
(かつ発見しにくい)正しさの欠落を持ち込むなら、緩和する価値がない。

M5(list/conditional factory closures)は、この判断とは独立に、現行の
静的解析とスコープ制限をそのまま維持して着手してよい。

## この決定がこれまでの判断とどう整合するか

- ADR-0004の「書かれていないものは作らない」「安全性より見た目の柔軟性を
  優先しない」という基準の直接の適用。
- 依存発見のスコープ制限を将来緩めるとしても、それは真に静的な制御フロー
  解析(全分岐の識別子を証明的に網羅する)によってのみ行うべきで、quixの
  ような単一実行サンプリング方式では代替できない。

## 未決定事項(後続で詰める)

- derivedのスコープ制限(単一concise arrow function式のみ)を、真に静的な
  制御フロー解析で緩める方向性自体は、この決定の対象外として残る。着手が
  必要になった時点で、別途スコープを切って検討すること。
