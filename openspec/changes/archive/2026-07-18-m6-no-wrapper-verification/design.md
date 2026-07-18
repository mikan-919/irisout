# m6-no-wrapper-verification design

## Context

ADR-0006 の no-wrapper 保証は M1 時点で `test/counter.test.ts` に
`not.toContain('signal(')` として1箇所あるだけ。以後の codegen 拡張
(M2 ハンドラ、M4 静的属性、M4.5 ゾーン、M5/M5.5 factory、ADR-0011 action)
は各機能のテストで動作検証されているが、「ラッパー不在」を横断的に固定する
テストは無い。M6 はテストのみで実施できる(実装に穴が見つかった場合のみ
別 change)。

## Goals / Non-Goals

**Goals:**

- 全機能を1フィクスチャに集約し、生成コードの no-wrapper と runtime import
  面(`mount`/`hydrate` のみ)を検証する。
- 同じフィクスチャを実 DOM で mount し、全機能のイベント駆動更新が動くこと
  を検証する(フィクスチャが「本物」であることの担保)。

**Non-Goals:**

- `src/**` の変更(検証で問題が出た場合は別 change として起票)。
- todomvc.jsx の全体コンパイル(動的 class/checked = UNRESOLVED 02/03 が
  未実装のため対象外)。
- minify 後の検証(ROADMAP「minify」は別論点)。

## Decisions

### D1: 検証は「全部載せフィクスチャ1つ」に集約する

マイルストーンごとに個別フィクスチャを並べるより、機能が同居した1つの
コンポーネントのほうが、機能間の干渉(例: action クロージャと derived
recompute の同居)まで1回で踏める。既存の per-milestone テストが個別動作を
既にカバーしているので、M6 の役割は「横断」のみ。

### D2: no-wrapper 判定は `signal(` / `derived(` の不在 + import 行の完全一致

生成コードに `signal(`・`derived(` が部分文字列として現れないこと
(counter.test.ts と同じ判定)に加え、import 文が
`import { mount, hydrate } from '../src/runtime.js';` の1行だけであることを
検証する。registry 等ビルド時専用シンボルの流出もこれで同時に検出できる。
フィクスチャ側は識別子に `signal`/`derived` を含む文字列リテラルを持たない
よう書く(誤検知回避)。

### D3: 挙動検証は jsdom 実 DOM + dispatchEvent

既存テストのイディオム(`el.dispatchEvent(new Event('click'))`、
`test/helpers.ts` の `createContainer`/`loadGenerated`)をそのまま使う。
検証する更新経路: ハンドラ書き込み → derived recompute → テキスト更新 /
リスト keyed diff(ネスト条件分岐込み)/ 条件分岐切り替え(ネストリスト
込み)/ action クロージャ再実行。

## Risks / Trade-offs

- [全部載せフィクスチャが scope limit に当たる] → 既存受理範囲
  (STATUS.md の制約一覧)の内側で書く: リストは sole-child・key 必須・
  concise body、アイテム内テキストは item 参照のみ、`use=` はトップレベル
  要素のみ、等。コンパイルが通ること自体もテストの検証対象。
- [文字列判定 `signal(` の誤検知] → フィクスチャの authored 側で該当部分
  文字列を避ける(D2)。
