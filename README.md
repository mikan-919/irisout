# irisout

**JSX を書く。ブラウザに届くのは、経験豊富なエンジニアが Vanilla JS で
手書きしたのと同じコードだけ。**

irisout は React の代替ではありません。JSX の宣言的な開発体験を保ったまま、
仮想 DOM もリアクティブランタイムも持たない、専用の DOM 更新コードへ
コンパイルするビルド時コンパイラです。

> もし人間がこの UI を Vanilla JavaScript で実装するなら、どう書くか?
>
> — [`CONCEPT.v2.md`](./CONCEPT.v2.md)

---

## これは何をするものか

```tsx
// examples/counter.jsx
export function Counter() {
  const count = signal(0)
  const doubled = derived(() => count() * 2)

  render(
    <div>
      <p>count: {count()} / doubled: {doubled()}</p>
      <button type="button" onClick={increment}>increment</button>
    </div>,
  )

  function increment() {
    count(count() + 1)
  }
}
```

このコンポーネントはビルド時に実行され、依存グラフに基づいて
「経験豊富なエンジニアが書いたであろう」コードへ直接コンパイルされます。
ブラウザに届くのは焼き込み済みの静的 HTML と、それを hydrate する
専用の更新関数だけです。仮想 DOM の diff も、汎用オブザーバーも、
signal ラッパーそのものも出力には残りません([`examples/counter.handwritten.js`](./examples/counter.handwritten.js) がその目標出力です)。

## なぜ

- **ゼロランタイム抽象化** — コンポーネント境界はビルド後に消える。
- **HTML ファースト** — 可能な限り静的 HTML を生成し、更新は
  影響を受ける DOM ノードだけを直接触る。
- **専用コード生成** — グローバルな汎用フレームワークコードではなく、
  各アプリケーション専用の `update_<signal>()` を生成する。
- **安全に拒否する** — 対応していない構文は黙って握りつぶさず、
  `compile: ... (scope limit)` で明示的に拒否する(ADR-0004)。

詳しい設計思想は [`CONCEPT.v2.md`](./CONCEPT.v2.md) を参照してください。

## クイックスタート

```bash
bun install
bun scripts/build.ts examples/counter.jsx
```

`dist/index.html`(初期 HTML 焼き込み済み)と `dist/app.js`(hydrate 専用、
innerHTML は一切書かない)が生成されます。ブラウザで `dist/index.html` を
開くだけで動作します。

## ベンチマーク

TodoMVC 相当のシナリオ(mount / filter / add / remove、N=100〜100,000)を
実 Chromium 上で計測した結果、`.map()` から生成した keyed 更新コードは
全シナリオ・全 N で React (`useState` のみ、非最適化) より高速でした
(1.1〜4 倍、中心は 1.4〜1.8 倍)。詳細な方法論と表は
[`bench/todomvc-vs-react.results.md`](./bench/todomvc-vs-react.results.md) にあります。

## 現在のステータス

TypeScript 実装は M1〜M6(全マイルストーン横断の no-wrapper 検証)まで
完了しており、「使ってもらえる閾値」(M5 + `use=` アクション)に到達
しています。

対応済み: signal / derived、テキスト・属性の動的バインディング、
イベントハンドラ、`.map()` によるリスト(keyed reuse)、条件分岐(1階層
ネストまで)、`use=` action(top-level 要素)、ハンドラ/action からの
動きゾーン関数呼び出しの追跡(ADR-0013)。

既知の制約(ルートコンポーネントは1つのみ、複数 mount 不可、2階層以上の
構造ネスト不可、など)は [`STATUS.md`](./STATUS.md) に一覧があります。
まだ実験的なコンパイラであり、実プロダクトでの採用は制約を理解した上で
検討してください。

## ドキュメント

| ファイル | 内容 |
|---|---|
| [`CONCEPT.v2.md`](./CONCEPT.v2.md) | プロジェクトの目的と哲学 |
| [`docs/architecture.md`](./docs/architecture.md) | コンパイラの内部構造・パイプライン |
| [`docs/conventions.md`](./docs/conventions.md) | コーディング規約 |
| [`STATUS.md`](./STATUS.md) | 実装ステータス・既知の制約 |
| [`ROADMAP.md`](./ROADMAP.md) | 設計判断待ちの論点・次のアクション |
| [`docs/adr/`](./docs/adr/) | 決定済みの設計判断(却下案も含む) |

## プロジェクト構成

```
src/
  compiler.ts      # パイプライン全体の統括(parse → analyze → build-time exec → codegen)
  compiler/        # ルート特定・JSX 走査・式解析・依存グラフ解決
  codegen.ts        # 依存グラフ → ES モジュール文字列組み立て
  runtime.ts         # signal/derived(ビルド時専用)+ mount/hydrate(ブラウザ出荷用)
scripts/build.ts     # .jsx → dist/index.html + dist/app.js
examples/            # サンプル入力・手書き目標出力
bench/                # React との性能比較ベンチマーク
test/                  # bun test(実 DOM は jsdom)
legacy/                # 旧 JS 実装(参照専用、メンテナンスしない)
```

## 開発

```bash
bun install
bun run test         # bun test
bun run typecheck    # tsc --noEmit
bun run check-all     # biome check --write → typecheck → test
```

コミット前は `bun run check-all` を通してください。フォーマット・lint は
biome に一任します。詳細は [`docs/conventions.md`](./docs/conventions.md)。

## ライセンス

未定(TBD)。
