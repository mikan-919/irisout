## Why

決定済みの ADR-0008(ゾーン API)は、ハンドラを `render()` より後ろの
**function 宣言**(ブロック本体)で書くと決めた例そのもの(`function
handleCountUp() { state(state() + 1) }`)が、現行コンパイラでは通らない ―
`src/compiler/render.ts` はハンドラのブロック本体と引数(イベントオブジェクト
`e` を含む)を明示的に scope limit として拒否している。ADR-0008 の実装は
どのみち文レベルのハンドラ解析を新設するが、イベント引数(`(e) =>
text(e.target.value)`)はフォーム系アプリの必須プリミティブでどの ADR も
規定していない。この2つを別々に決めると `analyze.ts` の解析層を二度設計
することになるため、ADR-0008 の実装計画を書く**前**に1本の ADR ドラフトへ
まとめて決着させる。M4 とは独立に、`examples/todomvc.jsx` の
`UNRESOLVED(09)`(イベント引数の型付け)を含むハンドラ関連の未規定 API を
入力として今すぐ着手できる。

## What Changes

- `docs/adr/0009-handler-statements-and-event-object.md` を**ドラフト
  (レビュー待ち)**ステータスで新規作成する。以下5点それぞれに推奨案・
  根拠・代案を書く:
  1. イベント引数(`e`)の受け渡し方式
  2. ハンドラのブロック本体として最初に許す文種の最小集合
  3. 条件分岐内の書き込み検出の意味論(静的過剰近似を維持するか)
  4. `analyzeHandlerExpr`(式単位の edit 方式)を文レベルへ拡張する形
  5. ADR-0008(識別子参照 + 巻き上げ function 宣言)との接続
- 上記の技術判断のうち検証可能なもの(ローカル変数の scope 解決・
  シャドーイング・早期 return 時の書き込み検出)を、リポジトリにコミット
  しない使い捨てスクラッチ実験で検証し、その結果を ADR の根拠として引用する。
- `ROADMAP.md` の該当する未規定 API 項目(`examples/todomvc.jsx` の
  `UNRESOLVED` のうちハンドラ関連、特に (09))を「ADR-0009 ドラフトあり・
  レビュー待ち」へ状態を付け替える。
- **`src/**`・`test/**` は一切変更しない**。これは設計スパイクであり、
  成果物は ADR ドラフトのみ。実装は本 ADR が承認された後の別の変更で行う。

## Capabilities

### New Capabilities

- `adr-0009-draft-deliverable`: ランタイムの振る舞いではなく、ADR-0009
  ドラフトという設計ドキュメント自体の完成条件(5つの設計質問への
  推奨案・根拠、スクラッチ実験結果の引用、ROADMAP.md の状態付け替え)を
  検証可能な要件として定義する。

### Modified Capabilities

(なし)

## Impact

- `docs/adr/0009-handler-statements-and-event-object.md`(新規、ドラフト)。
- `ROADMAP.md`(該当項目の状態付け替えのみ)。
- `src/**`・`test/**` への影響なし(スパイク実験は非コミット)。
- 依存: 後続で ADR-0008 の実装計画(M4.5)を書く前に、本 ADR がレビュー・
  承認されている必要がある(でなければ `analyze.ts` の文レベル解析を
  二度設計するリスクが残る)。M4 の実装そのものには依存しない。
