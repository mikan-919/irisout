## Context

`examples/todomvc.handwritten.js`はirisoutのADR-0005(keyed reuse + factory
closure)を手で適用したTodoMVC実装で、コンパイラが将来生成する出力の性能上限
とみなせる。M5の実装に入る前に、この上限がReact版TodoMVCと比べてどうかを
実測しておく。`bench/listener-strategy.ts`が既存のベンチマーク作法
(jsdom上、`bun run`で直接実行、Node標準の`performance.now()`/
`process.memoryUsage()`)を確立しているので、これを踏襲する。

## Goals / Non-Goals

**Goals:**
- handwritten TodoMVC vs React版TodoMVCで、同一シナリオの処理時間を比較する。
- ADR-0005の「keyed reuseのMapの帳簿コストはReact Fiberと同種」という
  見立てを、実測ベースで裏付けるか反証するか結論を出す。
- 結果をM5設計(design.md)の判断材料として`bench/`にレポートとして残す。

**Non-Goals:**
- ブラウザ実機・複数ブラウザでのクロスブラウザ計測(jsdom上の相対比較に
  留める。`bench/listener-strategy.ts`と同じ精度の割り切り)。
- irisoutコンパイラ本体(`src/`)の変更。
- Reactのバンドルサイズ比較(実行時性能のみが対象)。

## Decisions

### 1. 比較対象の実装ペア

- irisout側: 既存の`examples/todomvc.handwritten.js`をそのまま使う
  (新規に書き直さない — これ自体がM5の目標出力そのものであるため)。
- React側: `examples/todomvc.react.tsx`のような形で同等機能(追加・
  完了トグル・削除・フィルタ切り替え)のTodoMVCを新規実装する。keyed
  リストは`key={id}`を使った標準的なReact実装とする(非最適化の
  素朴な実装 — irisout側もチューニングしていないため公平)。

### 2. 計測シナリオ

`bench/listener-strategy.ts`のSIZES(100〜100,000)に倣い、以下を各Nで計測:
- 初期マウント(N件のitemがある状態からの初回描画)
- N件全アイテムの完了トグル(1件ずつ、フル走査)
- フィルタ切り替え(all→active→completed)
- 末尾へのアイテム1件追加(keyed reuseで既存アイテムが再生成されないか
  を確認する意味も持つ)
- 1件削除

### 3. 計測基盤

`bench/listener-strategy.ts`と同じ構成(jsdom + `bun run`で単体実行できる
スクリプト、`performance.now()`で時間、`process.memoryUsage()`でヒープ
差分)を`bench/todomvc-vs-react.ts`として新設する。Reactは
`react-dom/server`ではなくクライアントレンダリング
(`react-dom/client`の`createRoot`)をjsdom上で動かす。

### 4. 依存追加

`react` / `react-dom`を devDependency として追加する(本番の`src/`
コード・`bunx bun build`の対象には含めない — あくまでベンチマーク用)。

## Risks / Trade-offs

- [jsdomはブラウザの実レイアウト/ペイントを行わないため、実ブラウザでの
  絶対値とは乖離する] → `bench/listener-strategy.ts`と同様、相対比較
  (irisout版がReact版よりどれだけ速い/遅いか)としてのみ扱う。
- [React側実装があまりに素朴だと「藁人形」比較になる] → Reactの標準的な
  ベストプラクティス(key付きリスト、状態はuseStateで最小限)に沿わせ、
  意図的な劣化実装にしない。
- [結果がADR-0005の見立てと食い違った場合] → 本change自体はM5の実装を
  変更しない。結果はレポートとして残し、M5のdesign.mdが参照して必要なら
  設計を再検討する。

## Open Questions

- React 18/19どちらの挙動差(自動バッチング等)を計測対象にするかは、
  実装時に`package.json`のReactバージョンを固定して決める(tasks.mdで対応)。
