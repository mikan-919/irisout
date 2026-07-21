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

### 0. ハンドラからの関数越え書き込みが追跡されない(2026-07-19 発見)

**解消済み(ADR-0013、change `cross-function-handler-writes`、2026-07-19)**:
追跡(旧選択肢 (b))を採用・実装。callee の binding が動きゾーンの function
宣言に解決される呼び出しは本体を再帰解析(visited-set・深さ制限なし)し、
書き換え済み関数を出力に1回だけ emit する。binding 未解決(グローバル)は
素通し、ローカル解決だが動きゾーン関数でないものは scope limit(詳細は
STATUS.md 既知の制約)。

`scripts/build.ts`はminify未対応(ADR-0003で明示的に先送り)。counter
フィクスチャで手動計測: 995B→389B(約61%削減、`bun build --minify`)。
本番ビルドの話が優先度に上がったら着手、今は不要。

### 2. TodoMVC フィクスチャで発見した未規定API(plan 002, 2026-07-05)

`examples/todomvc.jsx` / `examples/todomvc.handwritten.js` の
`UNRESOLVED(nn)` コメントに対応。各項目は「何が未規定か / フィクスチャで
仮定した暫定構文 / どの ADR・マイルストーンで決めるべきか」の3点で書く。

- (01) ref の宣言・読み取りAPI / `const x = ref()` で宣言し `x()` で要素を
  取得する signal 同型の呼び出し規約を暫定採用 / **解消済み(ADR-0011、
  change `use-action-impl`)**: Svelte Action風の `use={fn}` を採用・
  実装し、ref primitiveは作らない(要素アクセスは use / `e`+プラット
  フォーム走査 / 返り値クロージャの3チャネル)。top-level要素のみで、
  ユニット内`use=`とJSX型定義は別change待ち(STATUS.md参照)。
- (02) 完了トグルに応じた動的 class 付与(`class={cond ? 'a' : ''}`)の
  生成先 / authored 側はJSXの三項式をそのまま書いた / **解消済み
  (ADR-0012、change `dynamic-attribute-bindings`)**: setAttribute 反映の
  動的属性バインディングとして実装。
- (03) checkbox の `checked` を DOM プロパティとして都度反映する仕組み /
  authored 側は `checked={todo.completed}` をそのまま書いた / **解消済み
  (ADR-0012)**: attribute/property の固定表(`checked`/`value` は
  プロパティ反映)で実装。
- (04) アイテムごとのローカル編集状態を authoring API でどう表現するか /
  コンポーネント全体で1つの `editingId` signal を代用(TodoMVCが同時1件
  編集の性質に依存した暫定策で、一般形には拡張できない) / **解消済み・
  実装済み(ADR-0014、change `same-file-component-composition`、
  2026-07-21)**: `TodoItem` コンポーネントの変数ゾーンに
  `const editing = signal(false)` を持たせ、構造ユニットへインライン化
  された「ローカルsignal」(`CONTEXT.md`)としてアイテムごとに独立させた。
  `editingId` ハックは`examples/todomvc.jsx`から除去済み。編集モードの
  表示切り替えは、span/input のDOM入れ替え(07、引き続き未解決)ではなく
  同一ユニット直下の動的class属性バインディングに変更した(詳細は
  `examples/todomvc.jsx`のコメント参照)。
- (05) フィルタで一時的にリストから外れるだけのアイテムを「削除」と
  区別する設計 / handwritten側は「todos配列からの削除」でのみkeyed Map
  から破棄し、フィルタでの非表示はDOM着脱のみで対応(状態保持を優先) /
  **区別自体は解決済み**(M5、spec.md「配列脱落とフィルタ除外の区別」):
  `update_<list>()`は`.map()`の対象配列そのものに対してkeyed diffを行う
  ため、keyが配列に残る限りMapエントリ・DOM要素・リスナーは保持される。
  ただし「フィルタで除外されたアイテムを表示からだけ外す」実際の手段
  (06と結合)はM5.5に残る。
- (06) 空リスト時に `<ul>` 自体を出さない条件分岐(リストが条件分岐に
  ネストする形) / handwritten側は要素の着脱ではなく `hidden` プロパティ
  で妥協 / **M5では明示的にスコープ外と確定**(design.md Decision 1、
  compile error `(scope limit)`)。M5.5で扱いを決める。
- (07) 編集モードでの `span`↔`input` 入れ替え(アイテム内にさらに
  ネストした構造ユニットが要る) / handwritten側はtemplateの再クローンで
  はなく都度DOM生成+display切り替えで妥協 / **M5では明示的にスコープ外と
  確定**(design.md Decision 1、compile error `(scope limit)`)。M5.5の
  スコープ拡張時に決めるべき。
- (08) 編集中テキストの下書きの保持先 / handwritten側は専用stateを
  持たず、編集開始時に一度だけ書き込んだinput要素自身のvalueを
  source of truthとした / ADR-0005/0008とも未言及、07と同じくM5.5で
  item内ローカルUI状態の一般的な扱いとして決めるべき。
- (09) イベントオブジェクト(`e`)の型付け / `e.target.value` にJSの
  動的型付けのまま素朴にアクセスした(targetがHTMLInputElementである
  保証はコード上ない) / **受け渡しは解決済み**(ADR-0009 承認済み・change
  `adr-0009-handler-statements` で実装、
  `docs/adr/0009-handler-statements-and-event-object.md`)。ハンドラの
  イベント引数受け渡し・ブロック本体(4文種)の文レベル解析は実装済み。
  `e` の**静的型付け**(target要素種別に応じた絞り込み)は ADR-0009 でも
  未決定事項として切り出したままで、引き続き未決定。

### 3. エスケープハッチ(手書きJSとの共存)

**棚上げ(2026-07-14、ADR-0010「棚上げの経緯」参照)。** 公式な逃げ道は
専用要素ではなく`use=`(ADR-0011): 実要素にactionを接続し、本体から
コンパイル管理外のグローバル関数へ委譲する(`window.LegacyLib.init(el)`は
式文1つなのでADR-0009の文種制限を素通りする)。`<Escape mount>`は
「インラインの不透明本体」の実需が出たら再起票する(その際は実要素への
不透明属性を第一候補に再設計)。「使ってもらえる閾値」は
M5 単体ではなく **M5+`use=`** と置き直す(2026-07-14 相談)。

### 4. 複数コンポーネント合成・複数ファイル・ビルド時実行の切り分け(2026-07-21 提起)

ADR-0001の未決定事項(「複数コンポーネント境界のインライン化」「ビルド時
実行のサンドボックス／副作用の扱い」)がM6完了後もそのまま残っている。
CONCEPT.v2.mdは「コンポーネント」「props」「コンポーネント階層」を
irisoutの責務として明言しているが、現状の実装は以下の理由でこれに
到達していない:

- `<Component/>`のようなJSXタグ参照そのものが
  `compile: component references (<${tagName}/>) are not supported yet
  (scope limit)`で拒否されていた(`src/compiler/render.ts`)問題は、
  **同一ファイル内に限り解消・実装済み**(下記参照)。
- `compile(source: string)`(`src/compiler.ts:137`)は単一文字列を1回だけ
  受け取るシグネチャで、モジュール解決の余地がない。加えて Program 直下は
  関数宣言のみ許可(change `scope-limit-coverage`、STATUS.md既知の制約)の
  ため、`import`文自体が現状scope limitで拒否される ― 複数ファイルは
  「未実装」以前に「入力として受け付けない」段階。

**同一ファイル内の合成は解消済み・実装済み(ADR-0014、change
`same-file-component-composition`、2026-07-21)**: `TodoApp`→`TodoItem`
(構造ユニットの中身の切り出し)を具体的な検証対象に、呼び出し箇所ごとの
コンパイル時ASTインライン化(render-tree走査より前の独立前処理パス
`src/compiler/inline-components.ts`)・propsはshorthand分割代入のみの
純粋な置換(ランタイムprimitiveなし)・名前衝突は検出時のみ対応
(signal/derived宣言名・動きゾーン関数名とも、衝突した側をコンポーネント名
で接頭辞化してリネーム)を実装した。
children/slot・自己/相互再帰参照はscope limitで拒否。詳細な制約は
STATUS.md参照。

以下は**複数ファイル**側のみ残る問い(同一ファイル内合成の実装とは
独立に検討してよい ― ADR-0014「検討した代替案」参照):

1. **複数ファイルにまたがる場合のビルド時実行の単位** ― ファイルごとに
   `new Function()`するのか、依存グラフ構築前にモジュールをフラット化して
   1回で実行するのか。ADR-0001未決定の「サンドボックス／副作用の扱い」は
   ファイル数が増えるほど無視できなくなる(build-time実行が複数ファイルの
   副作用順序に依存し始める)。
2. **モジュール解決の範囲** ― 相対import限定か、`node_modules`越しの
   コンポーネント共有(パッケージ化)まで見るか。CONCEPT.v2.mdの射程を
   超える可能性があるので、まずCONCEPT側の確認が要る。

複数ファイル対応(上記1・2)は、実需(具体的にどんなアプリを組みたいか)
が出ない限り今それだけで進める理由は薄い。ADR-0014(同一ファイル内合成)
の実装が完了したので、次に触るとすれば下記「次のアクション」9番
(型検査基盤)になる。

### 5. 基本機能セット(Svelte/Solid水準)のギャップ一覧(2026-07-21 提起、未着手)

「Reactほどではなく、Svelte/Solidぐらいの水準で実用に使われるための
最低限セット」を軸に現状を棚卸しした。§4(props・複数コンポーネント・
複数ファイル)は同一ファイル内合成がADR-0014で決定済みなので、それが
実装された**後**にも残る/別軸のギャップだけをここに積む。設計判断は
まだしていない。

- **context(ツリー越しの暗黙DI)**: ROADMAP・ADR・STATUSのどこにも記述が
  無い、今回はじめて言語化した論点。props(§4)が解決してもprop
  drillingを避ける手段が無いままになる。
- **onDestroy/cleanup**: `mount()`/`hydrate()`は一方向で、unmountという
  概念自体が実装に存在しない。`use=`アクションのcleanupも未実装
  (STATUS.md既知の制約)。
- **onMount的な、要素に紐付かない起動処理**: `use=`は要素単位のmount時
  実行はカバーする(ADR-0011)が、「特定の要素を持たない副作用」(例:
  タイマー開始、WebSocket接続)を書く場所が無い。ADR-0004「`onMount`/
  `onLeave`フックを保留」は意図的な先送りであり、ADR-0008の`onMount(...)`
  というコード例は構文イメージのみで未実装。
- **effect(DOM以外への副作用)**: `update_*()`はコンパイラが生成する
  内部関数のみで、author側が「signalが変わったら実行」を宣言する手段が
  無い(localStorage同期・analytics送信など、DOM更新を伴わない副作用が
  書けない)。
- **モジュールスコープの共有state(Svelteのstore相当)**: トップレベルの
  `const`宣言自体が現状scope limitで拒否される(change
  `scope-limit-coverage`)。§4の複数コンポーネントが解決しても、
  コンポーネント間で状態を共有する手段がこのままでは無い。
- **`bind:value`的な双方向バインディング糖衣**: ADR-0012は一方向の
  property反映のみを規定しており、双方向バインディングは
  value属性+`onInput`ハンドラの手書き配線が必要(手書き相当のまま)。

以下は「基本セットに含めるかどうか自体が未確定」な発展機能。
CONCEPT.v2.mdに記述が無く、in/outの判断すら未着手:
transition/animation、portal、error boundary、async/resource
(Suspense相当)、リクエスト単位のSSR(現状はビルド時に静的HTMLを1回焼く
だけで、動的な per-request 生成とは別モデル)。

## 次のアクション

実装順序は当初 **M4 → API変更(ADR-0008) → ADR-0009 → 性能ベンチ → M5** で
決定していた(2026-07-05 grilling、2026-07-14 相談)。実際にはM5を性能
ベンチより先に着手・完了した(下記4参照) ― 以後はこの実績の順序で読む。

1. ~~M4(静的host属性)~~ — **完了**(change `m4-static-host-attributes`)。
2. ~~API変更(ADR-0008のゾーン構造)~~ — **完了**(change `authoring-api-zones`)。
   render()マーカー・識別子参照ハンドラ・ゾーン配置強制を実装。
3. ~~ADR-0009 実装~~ — **完了**(change `adr-0009-handler-statements`)。
   ハンドラのブロック本体(4文種)・イベント引数 `e` の受け渡しを実装。
4. ~~M5(list/conditional の factory closure、ADR-0005)~~ — **完了**
   (change `m5-list-conditional-factory-closures`)。design.mdでUNRESOLVED
   (06)/(07)(ネストした構造ユニット)を明示的にスコープ外と確定し、1階層
   のみ実装。当初の実装順序(性能ベンチ→M5)より先にM5を着手・完了した
   (2026-07-14 相談: change選択の結果)。性能ベンチ(`perf-bench-todomvc-vs-react`)
   は下記7で完了。
5. ~~M5.5 — ネストした構造ユニット(06/07)~~ — **完了**(change
   `m5-5-nested-structural-units`)。既存のfactory-per-unit実装を1階層の
   ネストまで再帰適用(2階層以上は引き続きscope limit)。06は実DOM着脱
   (hidden妥協は却下)、07の生死ポリシーは既存の「破棄して作り直す」を
   踏襲し、新しい状態保持機構は作らなかった(同changeのdesign.md
   Decision 1/2)。
6. ~~エスケープハッチ設計~~ — **完了**(change `escape-hatch-design`、
   ADR-0010)。共存の単位(JSX要素1つ)・`<Escape mount={...} />`の記法・
   受理条件を決定。`src/`の変更は対象外(設計のみ)。
6a. ~~エスケープハッチ実装~~ — **棚上げ**(2026-07-14)。実装change起票
   直後に「ルート要素に`use=`すれば足りるのでは」の指摘で再検討し、
   `use=`+グローバル委譲を公式な逃げ道として実装を見送った(ADR-0010
   「棚上げの経緯」・上記「3. エスケープハッチ」参照)。
6b. ~~ref設計~~ — **完了**(change `action-use-attribute`、ADR-0011)。
   authoring API統治原則(穴のない宣言・プレースホルダーの向き・位置的
   リアクティビティ)を明文化し、`use={fn}`属性を要素へのaction接続手段
   として採用、ref primitiveは作らないことを決定した(UNRESOLVED(01)
   解消)。`src/`の変更は対象外。
6c. ~~`use=`属性実装~~ — **完了**(change `use-action-impl`)。
   `src/compiler/render.ts`の`use`属性解析・識別子解決、
   `src/compiler/analyze.ts`のネストした関数への再帰書き換え・返り値
   クロージャの依存解析、`src/codegen.ts`のmount時呼び出し・
   update_*配線を実装。JSX型定義への`use`属性追加は下記9へ切り出した。
7. ~~性能ベンチ: `examples/todomvc.handwritten.js` vs React 版TodoMVC~~ —
   **完了**(change `perf-bench-todomvc-vs-react`、詳細は
   `bench/todomvc-vs-react.results.md`)。当初のjsdom計測ではhandwritten版
   が一貫して1.3〜2.5倍遅く「ADR-0005の見立てが反証された」ように見えたが、
   実Chromiumでの再計測(`bench/todomvc-vs-react.playwright.ts`)で
   **全シナリオ・全Nでhandwritten版がReact版より1.1〜4倍速い**と判明し
   結論は逆転した。jsdomはDOM APIを全部JSで実装しており「DOMを触るほど損」
   という実ブラウザと逆のコストモデルを持つため、直接DOM操作の多い
   handwritten版を系統的に不利にする環境アーティファクトだった。
   ADR-0005の見立て(keyed reuseのMapの帳簿コストはReact Fiberと同種)は
   実ブラウザでは**支持され**、アイテムごとの直接リスナーを委譲方式へ
   変える性能上の動機は消えた(メモリ面の比較のみ未計測のまま残る)。
8. ~~動的属性バインディング(UNRESOLVED 02/03)~~ — **完了**(ADR-0012、
   change `dynamic-attribute-bindings`)。あわせてユニットホスト要素の
   ハンドラが黙って捨てられるバグを修正。
9. ~~同一ファイル内の複数コンポーネント合成(ADR-0014、UNRESOLVED-04)~~ —
   **完了**(change `same-file-component-composition`)。コンパイル時
   ASTインライン化(root scope + list itemのみ)・shorthand propsの
   コンパイル時識別子置換・ローカルsignal(構造ユニット専有の変数ゾーン)
   を実装し、`examples/todomvc.jsx`の`TodoApp`から`TodoItem`を切り出した。
   children/slot・自己/相互再帰参照・複数ファイルは引き続きscope limit
   (詳細はSTATUS.md既知の制約参照)。
10. **未計画:** authored `.jsx` の型検査基盤(`types/jsx.d.ts` + examplesの
   tsconfig組み込み)。`use=`のJSX型定義(ADR-0011 design.md Decision 6)は
   これに依存して先送りされている ― `signal`/`render`/ハンドラ属性を含め
   authored code の型宣言が現状一切無く、`use`だけ型を付けても
   エディタ体験は成立しないため、一括整備が前提。

## 参考資料

- `STATUS.md` — 現在地・マイルストーン進捗・既知の制約
- `CONCEPT.v2.md` — プロダクトコンセプト
- `docs/adr/0001`〜`0008` — 決定済みの設計判断
- `session/000_ts-rewrite-kickoff-and-m1.md` — 書き直しキックオフの全経緯、
  quixとの比較
- `plans/001-browser-build-target.md` — 直近実行したplan(M3)
- `bench/listener-strategy.ts` — M5のイベント配線方式の判断材料
- `bench/todomvc-vs-react.results.md` — 性能ベンチ結果(ADR-0005見立ての検証)
- `examples/counter.jsx` — `scripts/build.ts`の手動確認用サンプル
- `examples/todomvc.jsx` / `examples/todomvc.handwritten.js` — ADR-0008/M5
  の目標入力・目標出力フィクスチャ(plan 002)
