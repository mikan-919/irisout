# irisout

![irisout](./docs/assets/logo.webp)

**JSX を書く。ブラウザに届くのは、その UI に必要なコードだけ。**

irisout は React の代替ではありません。JSX の宣言的な開発体験を保ったまま、
静的に決められる処理をコンパイル時に解決し、仮想 DOM を介さず実 DOM へ
直接反映する compiler-first なコンパイラです。

> この UI に必要な仕事だけを、ブラウザで最も小さく素直に実行するには
> どう書くか?
>
> — [`CONCEPT.v3.md`](./CONCEPT.v3.md)

---

## これは何をするものか

```tsx
// examples/counter.jsx
export function Counter() {
  const count = signal(0)
  const doubled = derived(() => count() * 2)

  render(
    <div>
      <p>
        count: {count()} / doubled: {doubled()}
      </p>
      <button type="button" onClick={increment}>
        increment
      </button>
    </div>,
  )

  function increment() {
    count(count() + 1)
  }
}
```

このコンポーネントはビルド時に実行され、依存グラフに基づいて
必要な DOM 更新コードへコンパイルされます。ブラウザに届くのは焼き込み済みの
静的 HTML、専用の更新関数、そして動的構造に必要な最小限のコードだけです。
仮想 DOM や Fiber のような汎用実行基盤は使いません。

## なぜ

- **Compiler-first** — 静的に決められる構造・依存・更新先を事前に確定する。
- **HTML ファースト** — 可能な限り静的 HTML を生成する。
- **直接 DOM 更新** — 仮想 DOM を介さず実 DOMへ反映しつつ、Listの差分や
  複数更新のバッチなど、更新粒度は実測に基づいて最適化する。
- **最小ランタイム** — Listなど実行時にしか決まらない処理には小さな共有
  ヘルパーを許容し、使用した機能に必要なコードだけを含める。
- **安全に拒否する** — 対応していない構文は黙って握りつぶさず、
  `compile: ... (scope limit)` で明示的に拒否する(ADR-0004)。

詳しい設計思想は [`CONCEPT.v3.md`](./CONCEPT.v3.md) を参照してください。

## クイックスタート

```bash
vp install
vp build
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

| ファイル                                         | 内容                               |
| ------------------------------------------------ | ---------------------------------- |
| [`CONCEPT.v3.md`](./CONCEPT.v3.md)               | プロジェクトの目的と哲学           |
| [`docs/architecture.md`](./docs/architecture.md) | コンパイラの内部構造・パイプライン |
| [`docs/conventions.md`](./docs/conventions.md)   | コーディング規約                   |
| [`STATUS.md`](./STATUS.md)                       | 実装ステータス・既知の制約         |
| [`ROADMAP.md`](./ROADMAP.md)                     | 設計判断待ちの論点・次のアクション |
| [`docs/adr/`](./docs/adr/)                       | 決定済みの設計判断(却下案も含む)   |

## プロジェクト構成

```
packages/
  compiler/          # compiler本体とVite+ Testスイート
  runtime/           # ブラウザへ必要時に出荷する最小ランタイム
  bench/             # Reactとの性能比較ベンチマーク
apps/
  examples/          # Vite+でdev/buildできるサンプルと比較用fixture
vite.config.ts       # format・lint・typecheck・test・workspace共通設定
legacy/              # 旧JS実装(参照専用、メンテナンスしない)
```

## 開発

```bash
vp install
vp check             # Oxfmt + Oxlint + typecheck
vp test --run        # Vite+ Test
vp build             # apps/examplesをbuild
vp run @irisout/bench#bench
```

コミット前は `vp check && vp test --run` を通してください。共通設定は
`vite.config.ts`に集約しています。詳細は [`docs/conventions.md`](./docs/conventions.md)。

## ライセンス

未定(TBD)。
