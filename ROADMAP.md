# irisout ロードマップ

TypeScript書き直し(`session/000_ts-rewrite-kickoff-and-m1.md`参照)で
次に決めるべきこと・次のアクションをまとめたもの。個別の実装手順は
`openspec/changes/`に、受入条件の正本は`openspec/specs/`に、設計判断そのものは
`docs/adr/`に置く。この
ファイルは「次に何を、どういう順番でやるか」の地図。現在地・マイルストーン
進捗・既知の制約などの実装ステータスは`STATUS.md`を参照。

## 設計判断待ち(次のchangeを書く前に決めること)

### v3: 最小ランタイムとList更新粒度(2026-09-04 方針変更)

**第1段階実装済み(ADR-0015)**: `CONCEPT.v3.md`で「ランタイムを持たない」
ことを目的から外し、Listのkey照合・DOM順序調整を共有最小ランタイムへ移した。
listId / itemId / bindingIdを分離して保持し、値が変わったbindingだけを直接DOMへ
反映する。順序が同じitemの再挿入も行わない。仮想DOM、Fiber、汎用スケジューラは
導入していない。

変更itemの直接通知は比較済み(ADR-0017)。N=10,000の反復1件更新ではaddressedの
0.870ms/件に対してdirectは0.001ms/件、追加コストは比較fixtureでgzip +50B、heapは
ほぼ同等だった。この結果を受け、`collection(initial, keyOf)`と
`collection.update(key, updater)`を導入した(ADR-0019)。値だけの更新は対象handleへ直接
通知し、通常setterによる構造変更は従来どおり`reconcileList()`する。

component instance境界は実装済み(ADR-0018)。生成moduleの複数mount/hydrateと、
stateを持つ同じ子componentの複数使用を独立させた。

component unmount/action cleanupも実装済み(ADR-0022)。生成instanceの`unmount()`は
一度だけmount/hydrateされたinstanceをidempotently破棄し、top-level listener、
component-owned DOM、marker/List/conditional stateを解放する。`use=`の既存関数返り値は
update closureの意味を維持し、外部resourceの解除は`{ update?, destroy? }`の`destroy`
へ限定する。unit内`use=`のfactory lifecycleも`structural-unit-use-actions`で実装済み。
汎用lifecycle runtime・同instance再mountは引き続き対象外。

**第2段階実装済み(ADR-0020)**: 同一ハンドラ/action/追跡関数のwrite setに複数root
があり、同じmarkerへ依存する場合だけ、コンパイル時に専用同期batchを生成する。
derivedは一度ずつ再計算し、markerの和集合を重複なしで最終状態へ反映する。
`update_<name>()`とcollectionのkeyed direct経路は互換性のため残し、
`collection.update()`が共有markerに入るbatch時だけdirect通知を抑止する。

イベント配線は実Chromiumで`click`、`change`、`input`、`keydown`、`dblclick`、
`blur`を、`direct`、`delegated`、`capture`、`adapter`で比較した(ADR-0021)。
delegated/capture/adapterはリスナー数とJavaScriptヒープで有利だったが、delegatedは
`blur`を処理できず、captureは`currentTarget`と段階を変え、adapterはevent objectの
同一性を失った。native eventの意味を保つためproduction既定はdirectを維持する。
collectionの構造操作APIは、通常setterで表現できるため、実需と比較結果が出るまで
追加しない。

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

現行のexample buildは`apps/examples/vite.config.ts`へ統合され、production buildで
minifyを有効にしている。counterのsize budgetは`packages/compiler/test/golden.test.ts`
が同じVite+ build経路を測定し、component lifecycle固定費を含む5.5xを上限にする。

### 2. TodoMVC フィクスチャで発見した未規定API(初期fixture, 2026-07-05)

`apps/examples/todomvc.jsx` / `apps/examples/todomvc.handwritten.js` の
`UNRESOLVED(nn)` コメントに対応。各項目は「何が未規定か / フィクスチャで
仮定した暫定構文 / どの ADR・マイルストーンで決めるべきか」の3点で書く。

- (01) ref の宣言・読み取りAPI / `const x = ref()` で宣言し `x()` で要素を
  取得する signal 同型の呼び出し規約を暫定採用 / **解消済み(ADR-0011、
  change `use-action-impl`)**: Svelte Action風の `use={fn}` を採用・
  実装し、ref primitiveは作らない(要素アクセスは use / `e`+プラット
  フォーム走査 / 返り値クロージャの3チャネル)。top-level要素、list item、
  conditional branchで実装済み。JSX型定義はchange
  `jsx-type-checking-foundation`で解消済み(STATUS.md参照)。
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
  `editingId` ハックは`apps/examples/todomvc.jsx`から除去済み。編集モードの
  表示切り替えは、`editing() ? <input /> : <span />`という自然な条件分岐で
  実装した。itemごとのfactoryが`editing`とbranch handlerの更新先を所有する。
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
  compile error `(scope limit)`)した後、M5.5で構造unitを実装し、現在は任意の深さへ
  拡張済み。
- (07) 編集モードでの `span`↔`input` 入れ替え(アイテム内にさらに
  ネストした構造ユニットが要る) / handwritten側はtemplateの再クローンで
  はなく都度DOM生成+display切り替えで妥協 / **M5では明示的にスコープ外と
  確定**(design.md Decision 1、compile error `(scope limit)`)した後、
  `recursive-structural-authoring`で任意の深さの構造unitへ拡張した。各unit
  instanceの状態/cacheを分離し、祖先local signalの更新を所有者factoryへ接続する。
- (08) 編集中テキストの下書きの保持先 / handwritten側は専用stateを
  持たず、編集開始時に一度だけ書き込んだinput要素自身のvalueを
  source of truthとした / TodoItemの自然な条件分岐とlocal stateは実装済み。
  入力値の制御方式を一般化することは別のauthoring/API論点として残す。
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

### 4. 複数コンポーネント合成・複数ファイル・ビルド時実行の切り分け(完了: 2026-09-05)

同一ファイルの合成はADR-0014で決定・実装済みであり、複数ファイルの境界はADR-0024で
決定・実装済みである。`compileProject(entryPath)`が入口から相対`./`/`../`の静的
named/default importを辿り、`.js`/`.jsx`を依存順にASTリンクしてから既存のcompile
pipelineへ渡す。各fileを個別に`new Function()`せず、build-time executionはリンク済み
programを一回だけ実行する。

`render(<JSX>)`を持つfunctionはコンパイル時にinline化し、component functionとprops
objectを生成しない。componentでないfunctionと初期化済み単純`const`は補助宣言として
生成moduleのmodule scopeへ一度だけ出す。補助宣言はcomponentのstateを書き換えない純粋な
処理に限る。

module scopeのstate、副作用文、`let`/`var`、分割代入、外部specifier、未解決path、
namespace/side-effect/dynamic import、re-export、循環依存は`compile:`エラーで拒否する。
`compile(source)`は単一source APIとして保持し、module解決を行わない。fixtureと受入条件は
`apps/examples/multi-file/`、`packages/compiler/test/multi-file-module-composition.test.ts`、
`openspec/specs/multi-file-module-composition/spec.md`にある。

### 5. 基本機能セット(Svelte/Solid水準)のギャップ一覧(2026-07-21 提起、未着手)

「Reactほどではなく、Svelte/Solidぐらいの水準で実用に使われるための
最低限セット」を軸に現状を棚卸しした。§4(props・複数コンポーネント・
複数ファイル)の実装後にも残る/別軸のギャップだけをここに積む。設計判断は
まだしていない。

- **context(ツリー越しの暗黙DI)**: ROADMAP・ADR・STATUSのどこにも記述が
  無い、今回はじめて言語化した論点。props(§4)が解決してもprop
  drillingを避ける手段が無いままになる。
- **onDestroy/cleanup**: component instanceの明示的な`unmount()`とtop-level
  `use=` actionの`{ destroy }`はADR-0022で解消済み。要素を持たない処理に対する
  汎用`onMount`/`onDestroy`/effect runtimeは引き続き未着手。unit内action lifecycleは
  `structural-unit-use-actions`で実装済み。
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
CONCEPT.v3.mdに記述が無く、in/outの判断すら未着手:
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
   `recursive-structural-authoring`)。factory-per-unit実装を任意の深さへ
   再帰適用し、各unit instanceのDOM範囲、local state、binding cache、List Mapを
   分離した。祖先local signalの条件式・配列式・handlerは所有者factoryのupdateへ
   接続する。06は実DOM着脱、07は`span`/`input`の自然な条件分岐で解消した。
6. ~~エスケープハッチ設計~~ — **完了**(change `escape-hatch-design`、
   ADR-0010)。共存の単位(JSX要素1つ)・`<Escape mount={...} />`の記法・
   受理条件を決定。compiler/runtimeの変更は対象外(設計のみ)。
   6a. ~~エスケープハッチ実装~~ — **棚上げ**(2026-07-14)。実装change起票
   直後に「ルート要素に`use=`すれば足りるのでは」の指摘で再検討し、
   `use=`+グローバル委譲を公式な逃げ道として実装を見送った(ADR-0010
   「棚上げの経緯」・上記「3. エスケープハッチ」参照)。
   6b. ~~ref設計~~ — **完了**(change `action-use-attribute`、ADR-0011)。
   authoring API統治原則(穴のない宣言・プレースホルダーの向き・位置的
   リアクティビティ)を明文化し、`use={fn}`属性を要素へのaction接続手段
   として採用、ref primitiveは作らないことを決定した(UNRESOLVED(01)
   解消)。compiler/runtimeの変更は対象外。
   6c. ~~`use=`属性実装~~ — **完了**(change `use-action-impl`)。
   `packages/compiler/src/compiler/render.ts`の`use`属性解析・識別子解決、
   `packages/compiler/src/compiler/analyze.ts`のネストした関数への再帰書き換え・返り値
   クロージャの依存解析、`packages/compiler/src/codegen.ts`のmount時呼び出し・
   update_*配線を実装。JSX型定義への`use`属性追加は下記10で解消済み。
7. ~~性能ベンチ: `apps/examples/todomvc.handwritten.js` vs React 版TodoMVC~~ —
   **完了**(change `perf-bench-todomvc-vs-react`、詳細は
   `packages/bench/todomvc-compiler.results.md`)。当初のjsdom計測ではhandwritten版
   が一貫して1.3〜2.5倍遅く「ADR-0005の見立てが反証された」ように見えたが、
   実Chromiumでの再計測(`packages/bench/todomvc-compiler.playwright.ts`)で
   handwritten版とReact版の全シナリオを比較し、DOM更新方式とJavaScriptヒープ
   の差を記録した。jsdomはDOM APIを全部JSで実装しており「DOMを触るほど損」
   という実ブラウザと逆のコストモデルを持つため、直接DOM操作の多い
   handwritten版を系統的に不利にする環境アーティファクトだった。
   ADR-0005の見立て(keyed reuseのMapの帳簿コストはReact Fiberと同種)は
   実ブラウザでは**支持され**たが、List item配線専用の実Chromium比較
   (`packages/bench/listener-strategy.playwright.md`、ADR-0021)では、委譲が
   item identityのMap帳簿込みでもN=10,000/100,000のmount・attach・retained
   JS heapで有利だった。複数event fixtureの追加計測では、delegatedは`blur`を処理
   できず、captureは`currentTarget`と段階を変え、adapterはevent object同一性を
   失ったため、production配線はdirectを維持する(ADR-0021)。
8. ~~動的属性バインディング(UNRESOLVED 02/03)~~ — **完了**(ADR-0012、
   change `dynamic-attribute-bindings`)。あわせてユニットホスト要素の
   ハンドラが黙って捨てられるバグを修正。
9. ~~同一ファイル内の複数コンポーネント合成(ADR-0014、UNRESOLVED-04)~~ —
   **完了**(change `same-file-component-composition`)。コンパイル時
   ASTインライン化(root scope + list itemのみ)・shorthand propsの
   コンパイル時識別子置換・ローカルsignal(構造ユニット専有の変数ゾーン)
   を実装し、`apps/examples/todomvc.jsx`の`TodoApp`から`TodoItem`を切り出した。
   children/slot・自己/相互再帰参照は引き続きscope limit
   (詳細はSTATUS.md既知の制約参照)。
10. ~~authored `.jsx` の型検査基盤~~ — **完了**(change
    `jsx-type-checking-foundation`)。`types/jsx.d.ts`(グローバル`JSX`
    namespace・`signal`/`derived`/`render`のシグネチャ)+
    `apps/examples/tsconfig.json`(examples専用、ルートtsconfigとは分離)を実装。
    先送りされていた`use=`のJSX型定義(ADR-0011 design.md Decision 6)も
    あわせて解消した。属性名レベルの厳密化・コンポーネントprops型の
    厳密な推論は引き続き未対応(詳細はSTATUS.md既知の制約参照)。
11. ~~component instance境界~~ — **完了**(ADR-0018)。生成コードを
    `createComponent()`クロージャへ移し、同じ生成moduleの複数mount/hydrateと、
    stateを持つ同じ子componentの複数使用を独立させた。
12. ~~keyed collection item直接更新~~ — **完了**(ADR-0019)。
    `collection(initial, keyOf)`と`collection.update(key, updater)`を追加し、直接の
    `collection().map()`を全key走査なしで対象List handleへ更新する。
13. ~~同期更新バッチ~~ — **完了**(ADR-0020)。同一スコープの複数root writeが共有
    markerを持つ場合だけ、derived再計算とmarker反映を専用batchへまとめる。
    異なるmarker、単一root、collection direct経路、ローカルsignal updateは
    既存経路を維持する。
14. ~~component unmount + `use=` action cleanup~~ — **完了**(ADR-0022)。
    `createComponent()`/`mountComponent()`/`hydrateComponent()`の戻り値へ
    idempotentな`unmount()`を追加し、top-level handler removal、component-owned DOMと
    structural stateの解放、action `destroy`の逆順実行を実装した。既存の関数返り値は
    update closureのまま維持し、object返り値の`update`/`destroy`を型・解析・runtime
    検証へ追加した。unit内`use=`は`structural-unit-use-actions`で実装済み。
    再mount、汎用lifecycle runtimeは実装しない。
15. ~~再帰的構造unitと祖先local signal~~ — **完了**(change
    `recursive-structural-authoring`)。任意の深さのfactory生成、unit instance専有の
    DOM範囲・状態・binding cache、祖先local signalからのowner update接続を実装した。
16. ~~authoring coverage~~ — **完了**。`apps/examples/notes.jsx`と独立した
    `packages/compiler/test/authoring-coverage.test.ts`で、form、tabs、local state、
    条件分岐、nested List、同一ファイルcomponentを実DOMで確認した。
17. ~~構造unit内`use=` action lifecycle~~ — **完了**(change
    `structural-unit-use-actions`、ADR-0011/0022)。list item・conditional branch・
    任意のネストでactionをfactory handleへ接続し、keyed reorderの再利用、item削除・
    branch切替・祖先unit破棄・root unmountのdestroy、初期化失敗と破棄例外の回収を
    実装・検証した。

18. 次の一般用途対応は次の順番で検討する。大きな実装には着手しない。
    1. **優先度P1: 要素に紐付かない`onMount`/`effect`とcleanup**。データ取得、
       timer、WebSocketなどをDOM actionだけでなく処理単位で扱うために必要である。
       `use=`の`destroy`との責務分離、SSRなしのbuild-time実行との境界を先に決める。
    2. **優先度P1: context**。複数ファイルcomponentはpropsで接続できるが、深い
       component treeの共有依存はprops drillingになる。module scope stateを導入する
       前に、instance単位の所有権とcleanupを決める必要がある。
    3. **優先度P2: component propsとhandlerの型検査**。現行の`types/jsx.d.ts`は
       intrinsic要素と共通属性を検査するが、componentごとのprops型・イベント対象の
       絞り込みは弱い。module分割後の名前間違いとprops形状をbuild前に検出するために
       必要である。

## 参考資料

- `STATUS.md` — 現在地・マイルストーン進捗・既知の制約
- `CONCEPT.v3.md` — 現在のプロダクトコンセプト
- `CONCEPT.v2.md` — 旧コンセプト(履歴)
- `docs/adr/0001`〜`0024` — 決定済みの設計判断
- `session/000_ts-rewrite-kickoff-and-m1.md` — 書き直しキックオフの全経緯、
  quixとの比較
- `openspec/specs/` — 実装対象の受入条件の正本
- `packages/bench/listener-strategy.playwright.md` — ADR-0021の実Chromium計測結果
- `packages/bench/todomvc-compiler.results.md` — 性能ベンチ結果(ADR-0005見立ての検証)
- `apps/examples/counter.jsx` — Vite+ buildの手動確認用サンプル
- `apps/examples/todomvc.jsx` / `apps/examples/todomvc.handwritten.js` — ADR-0008/M5
  の目標入力・目標出力フィクスチャ
