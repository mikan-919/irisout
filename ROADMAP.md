# irisout ロードマップ

TypeScript書き直し(`session/000_ts-rewrite-kickoff-and-m1.md`参照)で
次に決めるべきこと・次のアクションをまとめたもの。個別の実装手順は
`plans/`(実行可能なplanのみ)に、設計判断そのものは`docs/adr/`に置く。この
ファイルは「次に何を、どういう順番でやるか」の地図。現在地・マイルストーン
進捗・既知の制約などの実装ステータスは`STATUS.md`を参照。

## 設計判断待ち(次のplanを書く前に決めること)

quixのビルド時トラッカー採用可否・list itemのイベント配線方式・authoring API
ゾーン化(inline arrow併存含む)とM4/M5の実装順序は決着済み(それぞれ
ADR-0007、ADR-0005の追記、ADR-0008+下記「次のアクション」を参照)。

### 1. minify

`scripts/build.ts`はminify未対応(ADR-0003で明示的に先送り)。counter
フィクスチャで手動計測: 995B→389B(約61%削減、`bun build --minify`)。
本番ビルドの話が優先度に上がったら着手、今は不要。

### 2. TodoMVC フィクスチャで発見した未規定API(plan 002, 2026-07-05)

`examples/todomvc.jsx` / `examples/todomvc.handwritten.js` の
`UNRESOLVED(nn)` コメントに対応。各項目は「何が未規定か / フィクスチャで
仮定した暫定構文 / どの ADR・マイルストーンで決めるべきか」の3点で書く。

- (01) ref の宣言・読み取りAPI / `const x = ref()` で宣言し `x()` で要素を
  取得する signal 同型の呼び出し規約を暫定採用 / ADR-0008 が明記する
  未決定事項そのもの、ref 設計の後続ADRで決めるべき。
- (02) 完了トグルに応じた動的 class 付与(`class={cond ? 'a' : ''}`)の
  生成先 / authored 側はJSXの三項式をそのまま書いた / M4(静的host属性)
  の後続として新規に計画が要る、現時点でロードマップに項目がない
  「未計画のパリティ穴」。
- (03) checkbox の `checked` を DOM プロパティとして都度反映する仕組み /
  authored 側は `checked={todo.completed}` をそのまま書いた / (02)と同様
  M4後続の新規計画が要る。
- (04) アイテムごとのローカル編集状態を authoring API でどう表現するか /
  コンポーネント全体で1つの `editingId` signal を代用(TodoMVCが同時1件
  編集の性質に依存した暫定策で、一般形には拡張できない) / ADR-0005は
  生成コード側の表現までしか規定しておらず、authored JSX側の構文は
  M5の設計時に別途決めるべき。
- (05) フィルタで一時的にリストから外れるだけのアイテムを「削除」と
  区別する設計 / handwritten側は「todos配列からの削除」でのみkeyed Map
  から破棄し、フィルタでの非表示はDOM着脱のみで対応(状態保持を優先) /
  ADR-0005のkeyed reuse決定に、フィルタ等「データは残るが表示対象からは
  外れる」ケースの扱いを追記すべき。
- (06) 空リスト時に `<ul>` 自体を出さない条件分岐(リストが条件分岐に
  ネストする形) / handwritten側は要素の着脱ではなく `hidden` プロパティ
  で妥協 / ADR-0005の「ネストした構造ユニットは対象外」スコープの
  裏返しのケースとして、M5設計時に扱いを決めるべき。
- (07) 編集モードでの `span`↔`input` 入れ替え(アイテム内にさらに
  ネストした構造ユニットが要る) / handwritten側はtemplateの再クローンで
  はなく都度DOM生成+display切り替えで妥協 / ADR-0005が明示的にスコープ外
  とする「リストアイテム内のネストした構造ユニット」そのもの、M5の
  スコープ拡張時に決めるべき。
- (08) 編集中テキストの下書きの保持先 / handwritten側は専用stateを
  持たず、編集開始時に一度だけ書き込んだinput要素自身のvalueを
  source of truthとした / ADR-0005/0008とも未言及、M5設計時にitem内
  ローカルUI状態の一般的な扱いとして決めるべき。
- (09) イベントオブジェクト(`e`)の型付け / `e.target.value` にJSの
  動的型付けのまま素朴にアクセスした(targetがHTMLInputElementである
  保証はコード上ない) / **受け渡しは解決済み**(ADR-0009 承認済み・change
  `adr-0009-handler-statements` で実装、
  `docs/adr/0009-handler-statements-and-event-object.md`)。ハンドラの
  イベント引数受け渡し・ブロック本体(4文種)の文レベル解析は実装済み。
  `e` の**静的型付け**(target要素種別に応じた絞り込み)は ADR-0009 でも
  未決定事項として切り出したままで、引き続き未決定。

### 3. エスケープハッチ(手書きJSとの共存)

コンパイラが受理しないパターンに当たったとき、その部分だけ手書き
vanilla JS に落として共存できる公式な逃げ道がまだない。1つの未対応
パターンがページ全体を止める構造なので、機能パリティを広げるより
優先度が高くなり得る(2026-07-14 相談)。「使ってもらえる閾値」は
M5 単体ではなく **M5+エスケープハッチ** と置く。設計は未着手 —
共存の単位(要素?ゾーン?)を決める ADR が要る。

## 次のアクション

実装順序は **M4 → API変更(ADR-0008) → ADR-0009 → 性能ベンチ → M5** で決定
(2026-07-05 grilling、2026-07-14 相談)。

1. ~~M4(静的host属性)~~ — **完了**(change `m4-static-host-attributes`)。
2. ~~API変更(ADR-0008のゾーン構造)~~ — **完了**(change `authoring-api-zones`)。
   render()マーカー・識別子参照ハンドラ・ゾーン配置強制を実装。
3. ~~ADR-0009 実装~~ — **完了**(change `adr-0009-handler-statements`)。
   ハンドラのブロック本体(4文種)・イベント引数 `e` の受け渡しを実装。
4. **次はここ:** 性能ベンチ: `examples/todomvc.handwritten.js` vs React 版
   TodoMVC。手書き版は irisout の生成出力の上限値なので、コンパイラ完成前に
   「React に性能で勝てるか」を実測で決着させる。M5 設計の判断材料
   (keyed reuse の Map は React も Fiber として持つ帳簿と同じ、という
   見立ての検証)。
5. M5(list/conditional の factory closure、ADR-0005)。設計時に
   UNRESOLVED(04)〜(08)、特にネストした構造ユニット(06/07)をスコープに
   含めるかを決める — TodoMVC 完走には両方必要(条件分岐の中のリスト、
   リストアイテムの中の条件分岐)。
6. その後: ref 設計(UNRESOLVED 01)、動的属性バインディング(02/03)。

## 参考資料

- `STATUS.md` — 現在地・マイルストーン進捗・既知の制約
- `CONCEPT.v2.md` — プロダクトコンセプト
- `docs/adr/0001`〜`0008` — 決定済みの設計判断
- `session/000_ts-rewrite-kickoff-and-m1.md` — 書き直しキックオフの全経緯、
  quixとの比較
- `plans/001-browser-build-target.md` — 直近実行したplan(M3)
- `bench/listener-strategy.ts` — M5のイベント配線方式の判断材料
- `examples/counter.jsx` — `scripts/build.ts`の手動確認用サンプル
- `examples/todomvc.jsx` / `examples/todomvc.handwritten.js` — ADR-0008/M5
  の目標入力・目標出力フィクスチャ(plan 002)
