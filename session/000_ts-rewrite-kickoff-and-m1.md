# 000: TypeScript書き直しキックオフ、Milestone 1実装、tooling整備

日付: 2026-07-05

## 概要

このセッションは大きく4段階に分かれる:

1. reactive性そのものについての哲学的な対話(APIの話ではなく、なぜreactiveが
   奇妙に感じるか、他のパラダイムはないか、という抽象度の高い議論)
2. その対話の結論を踏まえた「一から作り直したい」という要望への対応:
   TypeScript・bun test・単一パッケージでのスキャフォールド構築とMilestone 1
   (単一コンポーネント、signal/derived、テキストマーカーのみ)の実装
3. パーサー選定(Babel継続 vs oxc-parser/@swc/core)の検証
4. `/home/mikan/projects/quix`との比較調査、および Biome + husky の導入

## 1. 哲学的対話のまとめ

以下の流れで議論し、最終的に「hookの代わりにevent、signalもイベント受け渡し
として考えられるが、全部イベントにすると遅いので、コンパイルできるところは
コンパイルする」という結論に着地した。

- **useStateの気持ち悪さ**: 構文(ただのローカル変数)と意味論(呼び出し順序に
  依存する外部ストア参照)の不一致が原因。Signal系API(`count()`という関数
  呼び出しの見た目)はこの不一致を持たない。
- **`signal()`除去は2つの独立した問い**: ①著者が書くsource側(全JS代入文法の
  網羅が必要で困難、保留)と②コンパイラが吐くoutput側(コンパイラ自身が
  読み書き箇所を完全把握しているので、除去は自由な最適化として常に許される)。
  → これが後半のADR-0006の種になった。
- **書くこと(source) < 出力(output)で縮む分には問題ない**: ADR-0004の統治
  原則(生成コードがソースの意味的要求を超えて実行しない限り自由)の正確な
  読み方は「一致」ではなく「方向」。縮む(間接層を削る)のは常に許容、
  膨らむ(要求されていない実行を足す)のだけが禁止。
- **手動の依存管理の回避策**: 実行時読み取り追跡(Solid/Vue/MobX方式、
  signalの読み取りをトラッキングスタックで自動観測)が業界の標準解。
  ただし副作用のある複文には「if単位の細粒度」は原理的に無理(トリガーの
  正確さと再実行の単位の粗さは別の話)。JSXの条件分岐がそこだけ細粒度な
  のは、宣言的で副作用がないから構造的に分離できるだけ(ADR-0005の
  factory-per-unitと同じ発想)。
- **reactive性の別パラダイム探索**: 命令型(呼ぶ側が実行タイミングを決める)、
  reactive(データが実行タイミングを決めてpush伝播)の他に、需要駆動の
  増分計算(pull + memoization + early cutoff、Salsa/Adapton系)を検討したが、
  「常に表示されているUIには合わない」(誰も尋ねに来ない)という理由で
  却下。ただし「起こす一撃はpush、伝播の中身はpullで正しく計算する」という
  Conal ElliottのPush-Pull FRPと同じ折衷案には収束した。
- **最終結論**: DOMイベント(離散的で既にある)が起こす一撃、伝播は
  コンパイル時に確定した静的グラフ(`signalToMarkers`)を辿るpull的な処理。
  ADR-0004の「機構を増やさない」原則とも整合する、一番機構が少ない着地点。

## 2. 決定事項

- 一から書き直す。既存実装は `legacy/` へ退避(参照専用、以後メンテしない)。
- TypeScript / 単一パッケージ(モノレポにしない) / `bun test`(vitestは廃止)。
- パーサーは **Babel継続**。oxc-parser・@swc/coreを実際にインストールして
  検証した結果:
  - 速度差は実測(369バイトの実コンポーネント規模)でBabel 50.78µs vs
    oxc 22.43µs。約2.3倍速いが、絶対値としては無視できる差。
  - oxc-parser・@swc/coreとも、npm向けJS APIにはBabelの
    `path.scope.getBinding()`相当のスコープ/バインディング解決が**露出して
    いない**ことを実機で確認(`oxc.parseSync()`は`program`/`module`/
    `comments`/`errors`のみ返す、`swc.parse()`も`type`/`span`/`body`/
    `interpreter`のみ)。乗り換えるとdeclIdByKeyの変数解決を自前実装する
    必要があり、割に合わない。
  - Babel自体は現役("Babel 8"へ移行中、7.29.0が最後のマイナーリリース、
    直後に8.0.0)。「開発終了」はwebpackの話との混同だった(webpackも
    死んではいないが、2026年時点で新規ツール開発の起点にはほぼならない、
    という状況)。
- ADR-0006を新規作成: 「生成コードはsignal()/derived()ランタイムラッパーを
  持たない」。著作面(source)は変更なし、出力面(output)はプレーン変数化。
  ADR-0005(リストアイテムのfactory closure)が既にアイテムローカル状態で
  やっていることを、トップレベル状態にも広げるだけ、という位置づけ。

## 3. 実施した作業

### リポジトリ再構成

```
git mv src legacy/src
git mv test legacy/test
git mv examples legacy/examples
git mv scripts legacy/scripts
git mv package.json legacy/package.json
mv bun.lock legacy/bun.lock   # untracked だったので mv
```

`CONCEPT.v2.md` / `docs/adr/*.md` / `plans/*.md` はルートに残置(生きている
設計文書のため)。

### 新スキャフォールド

- 新規 `package.json`(TypeScript, `@types/bun`, jsdom, bun test)。
- `tsconfig.json`(`lib: ["ES2022", "DOM", "DOM.Iterable"]`、
  `noUncheckedIndexedAccess`、`verbatimModuleSyntax`等、strict構成)。
- `bun test`は素の `bun test` だと `legacy/test/` まで拾って
  `process.cwd()`相対パスでクロス配線し壊れることが判明したため、
  `--path-ignore-patterns='legacy/**'`を付与。

### Milestone 1 実装(単一コンポーネント、signal/derived、テキストマーカーのみ)

`src/{compiler.ts, compiler/{state,analyze,decl-graph,render}.ts, codegen.ts,
runtime.ts, template.ts}` をTS移植。ADR-0006を最初から反映しているため、
legacyのM1とは出力の形が異なる:

- `analyzeExpr`が2種類のレンダリングを返すよう拡張: `rendered`(出力用、
  `count()`のような読み取り呼び出しを裸の識別子`count`へ書き換え済み)と
  `sourceRendered`(ビルド時実行用、呼び出し構文を保持 -- ビルド時実行では
  `count`は本物のsignalアクセサ関数のまま)。
- `derived`は遅延関数ではなくなるため(プレーン変数化)、依存するroot signal
  の`update_*()`内で、その値を先に再計算してからマーカーを更新するロジックを
  新規実装。derived-of-derived(連鎖)はM1のスコープ外として明示的に
  compile errorにしている(トポロジカル順序の計算が必要になり今回のスコープ
  を超えるため)。
- `test/counter.test.ts`: legacyのmilestone-1フィクスチャを移植。**ただし
  1点、意図的にlegacyから変更**: `mod.count(5)`のような外部からの直接書き込み
  テストは削除。新設計ではトップレベル状態がプレーン変数になり本物のsignal
  アクセサでなくなるため、外部から書き換える手段が(意図的に)存在しない。
  「書き込んでDOMが更新されるか」の実質的なテストはM2(ハンドラ実装)の
  `test/handlers.test.ts`(実DOMイベントのdispatch経由)に持ち越し。

生成コードの実例(`Counter`コンポーネント、`count`+`doubled`):

```js
import { mount } from '../src/runtime.js';

export let count = 0;
export let doubled = count * 2;

const __INITIAL_HTML__ = "<div data-iris-id=\"m0\">0</div>";

let __markers__;
export function mountComponent(container) {
  ({ markers: __markers__ } = mount(container, __INITIAL_HTML__));
}

export function update_count() {
  doubled = count * 2;
  { const __el = __markers__.get("m0"); if (__el) { __el.textContent = `${count + doubled}`; } }
}
```

`bun run typecheck` / `bun run test` ともにグリーン。

### Biome + husky 導入

`/home/mikan/projects/quix`のbiome.jsonを参考に、`legacy/`を除外する形で
導入(`files.includes: ["**", "!legacy"]`)。`noNonNullAssertion`はAST位置
(`node.start`/`node.end`)を頻繁に扱うコンパイラのコード特性上、頻出して
現実的でないため無効化。`check-all`スクリプト(`biome check --write && bun
run typecheck && bun run test`)を追加し、`.husky/pre-commit`から呼ぶ構成
(quixと同じ形)。

## 4. quixとの比較で得た知見

`/home/mikan/projects/quix`(同じ問題領域: 宣言的記述からVanilla JS生成、
Zero-Runtime)を調査。

- **根本思想は一致**: Build-time Execution / Zero-Runtime / "Everything is a
  Getter"。独立に同じ結論に来ているのは設計の妥当性の傍証。
- **依存発見方式が根本的に違う(要検討)**: irisoutはBabelの
  `scope.getBinding()`による**静的**解析。quixは`core/tracker.ts`で、JSX式を
  `() => expr`にラップしビルド時に**実際に1回実行**し、実行中にstateの
  getterが`tracker.report(id)`を呼ぶことで依存を発見する(実行時読み取り
  追跡を、ブラウザではなくビルド時Nodeだけでやる折衷案)。任意の複雑な制御
  フローを含む式でも静的解析の網羅性問題なしに依存発見できる。**M2以降で
  irisoutのderivedのscope limit(単一concise arrow functionのみ)を緩める
  設計オプションとして持ち帰り、まだ採用は未決定。** ハンドラの書き込み
  検出はこの方式が使えない(ビルド時に実行できないため)ので、quixも静的
  AST書き換え(`(s,e) => s.val(e.target.value)` → `e => (_a = e.target.value,
  _u_a())`)を使っており、これはirisoutのM2設計と同じ発想で答え合わせになった。
- **swcの使い方の答え合わせ**: quixの`packages/transform`は`@swc/core`の
  JS APIではなく独自のRust製SWC WASMプラグインを書いている。理由は
  quixの変換が「JSX式を`() => expr`で包むだけ」の純粋構文変換で、スコープ
  解決が要らないから。irisoutのようにスコープ解決自体をASTレイヤーでやる
  設計だと同じ手は使えない、という以前のBabel/oxc/swcベンチの結論を裏側
  から補強する実例だった。
- **Props bridging / list-conditionalの設計が独立に収束**: quixのビルド時
  Proxy転送による"shortcut update"はirisoutの`bareTrackedDeclId`によるエイ
  リアス機構と同じ設計。`For`コンポーネントの`<template>`+アンカー、Web
  Components不使用もADR-0005と一致。テンプレート構造発見のための
  「ダミー値でのprobe実行」(`spyItem`/`tracker.startProbing()`)は、M5
  (未実装)のアイテムローカル状態と外側依存の切り分けに応用できそうな技法。
- **採用しないもの**: `component().props().state()`のビルダーチェーンAPIは
  ADR-0004が却下したhyperscript風APIそのものなので踏襲しない。Zod駆動の
  props検証は良い発想だが、irisoutはまだ複数コンポーネント間propsが未実装
  なので時期尚早。

## 5. 今後

M2-M6のロードマップは `/home/mikan/.claude/plans/shiny-spinning-mochi.md`
に記載済み(このplanファイルはセッション終了後に消える可能性があるので、
重要な決定はこの `docs/adr/`・`plans/` に移すこと)。次の一手は M2
(イベントハンドラ + 書き込みトリガー更新)。quixのtracker方式を採用するか
どうかは、M2着手前に改めて判断する必要がある。
