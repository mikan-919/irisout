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
// apps/examples/counter.jsx
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
innerHTML は一切書かない)が生成されます。既定のList playgroundでは、itemの
追加・1件更新・並べ替え・削除とkeyed DOM再利用を試せます。

入口を分割したfixtureは次でビルドできます。

```bash
cd apps/examples
IRISOUT_ENTRY=multi-file/App.jsx vp build
```

`compileProject(entryPath)`は相対`.js`/`.jsx`の静的importを依存順にリンクし、
componentをコンパイル時にインライン化します。通常の補助関数と`const`は生成moduleへ
残ります。module直下の直接`const name = signal(initial)`はmodule共有signalとして受理し、
参照された場合だけ生成moduleの共有cellとinstance購読を出力します。外部module、dynamic
import、re-export、循環依存、module scopeの`derived`/`collection`や副作用文は受理しません。
`compile(source)`は単一文字列APIとして残ります。

## ベンチマーク

TodoMVC 相当のシナリオ(mount / filter / add / remove、N=100〜100,000)を
実 Chromium 上で計測した結果、`apps/examples/todomvc.handwritten.js` の
keyed再利用による手書き基準は全シナリオ・全 N で React (`useState` のみ、
非最適化) より高速でした(1.1〜4 倍、中心は 1.4〜1.8 倍)。これはM5の
生成物を評価する基準fixtureの比較であり、現行compilerが生成したproduction
生成物そのものの比較ではありません。初期計測の方法論と表は
[`packages/bench/todomvc-vs-react.results.md`](./packages/bench/todomvc-vs-react.results.md)
にあります。

2026-09-05に、現行コンパイラ生成版と手書き基準、React productionの比較を
Chromium 152.0.7977.75で追加計測した。N=100/1,000/10,000、予熱2回後7回の
中央値であり、手書き版をirisoutの生成性能とは扱わない。転送量、初期化、更新、
DOM変更、JavaScriptヒープ、生成コードの調査は
[`packages/bench/todomvc-compiler.results.md`](./packages/bench/todomvc-compiler.results.md)
にある。

## 現在のステータス

TypeScript 実装は M1〜M6(全マイルストーン横断の no-wrapper 検証)まで
完了しており、「使ってもらえる閾値」(M5 + `use=` アクション)に到達
しています。

対応済み: signal / derived、keyed collectionの1件直接更新、テキスト・属性の
動的バインディング、イベントハンドラ、`.map()` によるリスト(keyed reuse)、
任意の深さの条件分岐・構造unit、`use=` action(top-level要素・list item・branch)、ハンドラ/action
からの動きゾーン関数呼び出しの追跡(ADR-0013)、複数root writeで共有markerを
一度だけ反映する同期更新batch(ADR-0020)、component instanceの
`unmount()`と`use=` actionの`{ update?, destroy? }` cleanup(ADR-0022)、相対moduleの
複数ファイル合成(ADR-0024)。

`mountComponent(container)` / `hydrateComponent(container)` は instance を返します。
instanceは一度だけmount/hydrateでき、`unmount()`はidempotentです。既存の
`use={action}` の `() => void` 返り値は従来どおりリアクティブ update closure のままです。
timer・subscription・外部 listenerなどactionが確保したresourceは、object形式の
`{ destroy() { ... } }` で解除します。list item・conditional branchのactionは各factory
instanceが所有し、keyed reorderでは再初期化せず、item削除・branch切替・祖先unit破棄・
root `unmount()`でdestroyします。ルートcomponentの動きゾーンでは
`onMount(() => void | (() => void))`を使えます。callbackはmount/hydrate完了後に一度だけ
実行され、返り値のcleanupはunmount時に逆順で一度だけ実行されます。再mount、
構造unit内の`onMount`とinline化される子componentの`onMount`は、rootまたはunitの
instanceが所有します。ルートcomponentの動きゾーンでは`effect(() => void | (() => void))`
も使えます。callback本体が読むsignal/
derivedの更新時に再実行され、返り値のcleanupは再実行前とunmount時に呼ばれます。
effect本体から追跡signalへ書き込むこと、非同期schedulerを暗黙に導入することはscope
limitです。構造unit内・inline子componentのeffectは各unit/root instanceが所有します。
component treeの共有依存には、トップレベル`const Theme = createContext(defaultValue)`、
変数ゾーンの`provideContext(Theme, value)`、JSX式の`useContext(Theme)`を使えます。
consumerは最も近いproviderまたはdefault値へコンパイル時に置換され、root・list item・
conditional branchの各instanceが自身の値と更新依存を所有します。contextを使わない生成物に
context runtimeやMapは出力しません。構造unitの動的provider treeとPromiseLikeを扱う非同期
contextは静的置換として受理します。module共有stateは`compileProject`の直接signalに限り、
`derived`/`collection`や汎用storeはscope limitです。

既知の制約(ルートコンポーネントは1つのみ、children/slot未対応、module解決は相対
importのみ、など)は [`STATUS.md`](./STATUS.md) に一覧があります。
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
| [`openspec/specs/`](./openspec/specs/)           | 実装対象の受入条件・仕様           |

## プロジェクト構成

```
packages/
  compiler/          # compiler本体とVite+ Testスイート
  runtime/           # ブラウザへ必要時に出荷する最小ランタイム
  bench/             # Reactとの性能比較ベンチマーク
apps/
  examples/          # Vite+でdev/buildできるサンプルと比較用fixture
    multi-file/      # 相対module分割のfixture
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
