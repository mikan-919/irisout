# irisout ロードマップ

TypeScript書き直し(`session/000_ts-rewrite-kickoff-and-m1.md`参照)で
次に決めるべきこと・次のアクションをまとめたもの。個別の実装手順は
`openspec/changes/`に、受入条件の正本は`openspec/specs/`に、設計判断そのものは
`docs/adr/`に置く。この
ファイルは「次に何を、どういう順番でやるか」の地図。現在地・マイルストーン
進捗・既知の制約などの実装ステータスは`STATUS.md`を参照。

## 当面の開発目標(2026-09-06)

**資料の「情報量ヒートマップ」を素直に実装できるフレームワークを目指す。**
作者自身が使い、他の人にも使ってもらうことを目的に、このツールを次の開発判断の
題材とする。機能追加の優先順位は、ツールの実装で必要になる処理と、実装を妨げる
制約を確認して決める。

想定するツールは、資料の文章を貼り付け、ブラウザ内で解析し、段落ごとの特徴を
色で表示するもの。資料全体の地図から本文へ移動し、原文のどこを読むかを選べる
ようにする。以下は初期案であり、個別機能の受け入れ条件は実装前に定める。

- 文章の貼り付けと段落への分割。
- 数値・日付・固有名詞、用語の集中、初出語、段落間の繰り返しを使った表示の切り替え。
- 段落の色付けと、その計算理由の表示。
- 資料全体を見渡す地図と、選択した段落への移動。
- 入力や解析条件の変更に応じた結果の更新。

注: 「情報量」は文章の特徴から計算する指標の仮称であり、内容の重要性や正しさを
判定するものではない。指標の定義と、段落の長さによる偏りの扱いは検証して決める。
初期案は文章の貼り付けを入口とし、PDFからの本文抽出は後続の検討に分ける。

irisoutの到達基準は、入力、解析処理の呼び出し、状態管理、結果の一覧と色付け、
本文への移動を、通常のコンポーネントと処理の分割で記述できることとする。
コンパイラの制約を避けるためにアプリ側の構造を歪める必要が出た場合は、
その具体例をもとに対応範囲を見直す。解析用ライブラリの利用や非同期処理、
画面操作を止めないための別スレッドでの処理は、必要性を確認して設計する。
注: 別スレッドでの処理とは、ブラウザの画面操作を担当する処理から解析を分離すること。

既存の設計原則と生成コードの性能検証は継続する。この目標の保存時点では、
ツールの実装方式や解析ライブラリの選定、個別機能の追加までは決定しない。

## ヒートマップに向けた実装順序(2026-09-06)

以下を次の作業順序とする。後段の「次のアクション」は過去の実装記録であり、
未完了項目の優先順位はこの節に従う。調査結果と再現方法は
[`docs/heatmap-readiness.md`](./docs/heatmap-readiness.md)を参照。
各段階では代表例を動かして受け入れ条件を確認し、生成コードの検証を継続する。

### 1. 開発中の検査と編集反映を揃える(実装済み・2026-09-06)

- 通常の検査コマンドへJSX専用の型検査を組み込む。現状は`typecheck`が通っても、
  `typecheck:tsc`だけが検出する型エラーがある。まず数値signalへの文字列代入と
  props・イベントの誤用が通常の検査で失敗することを確認する。
- examples専用のVite連携から、別のアプリでも利用できる連携を切り出す。
  入口と相対依存を監視し、編集後のHTMLとJSを再生成する。現状は起動時の生成結果を
  保持する。コンパイラが読み込んだ依存一覧を連携側へ渡す境界も定める。
- 完了条件: サーバーを再起動せずに入口・子コンポーネント・補助関数の変更が反映され、
  構文エラーを直した後も復帰できる。まずページ全体の再読み込みとし、状態保持は後回しにする。

### 2. 非同期の更新漏れと不正な生成物を解消する(実装済み・2026-09-06)

- `async`ハンドラから`async`が落ちて不正な`await`を出力する問題と、ハンドラ内の
  `.then()`の書き込み後にDOMが更新されない問題を修正する。先に回帰試験で再現を固定する。
- 同期ハンドラ、Promise完了時、入れ子のコールバックで更新の実行位置を揃える。
  非対応経路は不正な生成や更新漏れのまま受理せず、コンパイル時に拒否する。
- `try/catch/finally`による成功・失敗・終了処理をどこまで受理するかを決める。
  完了条件は、解析開始・結果反映・失敗表示の代表例でDOMの状態を確認できること。
  `onMount`経由では更新できたため、非同期処理全般の作り直しとはしない。

### 3. 同期解析のヒートマップを通常の部品構成で作る(実装済み・2026-09-06)

- 本文→段落→集計→表示値という`derived`の連鎖を受理する。順序と循環の診断、
  複数入力が変わる場合の再計算を試験し、アプリ側で同じ計算を複製せずに済むようにする。
- 一覧・条件分岐内からルート状態を読む依存を接続する。表示指標や選択段落を
  各行のclassへ反映する例を、直接参照とprops経由で確認する。
- 状態を持つ子コンポーネントを条件分岐内へ配置できるようにする。
  詳細パネルの表示切り替えで初期化・更新・破棄の所有者を確認する。
- `apps/`に本文入力・指標選択・段落一覧・全体地図の代表アプリを置く。
  初期指標は段落長や数値の割合など、外部辞書なしで検証できるものから始める。
  class/style文字列と段落リンクは既存機能を使い、専用の色付けAPIは前提にしない。
- 完了条件: 入力変更、指標切り替え、選択表示、段落への移動が連動する。
  日本語や記号を含む原文を保ち、色の理由を確認できる。指標の定義はアプリ側に置く。

### 4. 解析用の依存と資源をブラウザへ渡す(実装済み・2026-09-06)

- コンパイル対象のJSXと、通常のJavaScriptライブラリの境界を決める。
  現状の相対`.js`/`.jsx`限定の読み込みに対し、外部パッケージをビルド処理へ渡す
  経路を設ける。ライブラリ内部すべてをirisoutの記法として解析しない構成を検証する。
- CSS、辞書等のURL、Worker入口の扱いを同じ代表アプリで確認する。
  ブラウザ専用の初期化をビルド時に実行せず、既存の初期化・破棄処理へ接続する。
- 完了条件: 選定した解析ライブラリと必要な資源を開発・本番の両方で読み込める。
  配信先にパスの接頭辞がある場合も動き、未使用の依存を生成物へ含めない。
  ライブラリと辞書はこの段階で調査・選定し、全文解析を端末内で行う。

### 5. 長文と連続入力を扱う(実装済み・2026-09-06)

- Workerへ解析を分離する代表例を作る。古い要求の結果を採用しない識別、処理中と
  失敗の表示、画面破棄時の終了をアプリ側で記述し、非同期の更新経路を検証する。
- 日本語の文字確定前に再解析を繰り返さないこと、キーボードで段落へ移動できること、
  色以外でも指標を読めることを実ブラウザの操作試験へ追加する。
- 文章量と段落数ごとに解析時間、表示更新時間、メモリ使用量、操作への応答を測る。
  測定結果から対応上限と完了基準を決める。全段落の表示が問題になった場合に限り、
  表示範囲の限定を検討する。注: 表示範囲の限定とは、画面付近の段落だけをDOMへ置くこと。

### 6. 他の人が試せる開発環境にする(実装済み・2026-09-06)

- 元ファイル・行・列を含む診断、導入用の型定義、別アプリの設定例を用意する。
  診断を先に整え、生成コードのソースマップは必要な範囲から検討する。
- 実装と異なる型定義のコメント、対応状況、検査手順を更新する。
  自動検査へ型検査・試験・ビルドを登録し、別ディレクトリからの導入を確認する。
- ライセンスと配布形式を決め、作者以外が導入して文章を解析する手順を検証する。
  パッケージの公開は、この計画更新だけで実行するものではない。

### 今回は先に広げない範囲

childrenによる共通パネル、SVG、双方向入力の省略記法、モジュール共有派生状態は、
代表アプリで必要になった例から再検討する。PDF抽出、サーバーでの要求ごとのHTML生成、
画面遷移の基盤、汎用の非同期実行基盤、学習済みモデルの導入は初期版の必須条件にしない。
注: SVGは図形を要素として記述する形式であり、初期版の地図はHTML要素で構成できる。

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
ルートcomponentの`onMount`とcleanupも実装済み(ADR-0025)。callbackは
mount/hydrate完了後に一度実行し、返り値のcleanupをunmount時に逆順で呼ぶ。ルートcomponent
の`effect`とcleanupも実装済み(ADR-0026)。依存root signalの専用`update_*()`へ接続し、
再実行前とunmount時にcleanupを呼ぶ。汎用lifecycle runtime、同instance再mountは引き続き
対象外。構造unit内・inline子componentの`onMount`と`effect`はunit/root instance所有へ
拡張済み。

instance単位のcontextもADR-0027で実装済みである。トップレベルcontext key、変数ゾーンの
provider、JSX式のconsumerをコンパイル時に静的置換し、root・list item・conditional branchの
所有instanceへ依存を接続する。汎用context runtime・Mapは出力しない。構造unitの動的provider
treeと非同期contextは静的置換として実装済みで、runtime provider伝播・非同期schedulerは
対象外とする。module共有signalはADR-0030、module共有derivedはADR-0037の直接形だけを実装する。

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
  保証はコード上ない) / **解決済み**(ADR-0009 承認済み・change
  `adr-0009-handler-statements` で実装、
  `docs/adr/0009-handler-statements-and-event-object.md`)。ハンドラの
  イベント引数受け渡し・ブロック本体(4文種)の文レベル解析は実装済み。
  change `component-props-handler-type-checking`で6イベントをDOMイベント型へ
  対応付け、直接listenerを持つ要素型へ`currentTarget`を絞った。`target`は
  子要素になり得るためDOM標準型を維持する。

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
生成moduleのmodule scopeへ一度だけ出す。直接`const name = signal(initial)`はADR-0030の
共有signal、直接`const name = derived(() => expression)`はADR-0037の共有derivedとして
参照時だけ出力する。その他の補助宣言はcomponentのstateを書き換えない
純粋な処理に限る。

module scopeの直接signal/derived以外のstate、副作用文、`let`/`var`、分割代入、外部specifier、未解決path、
namespace/side-effect/dynamic import、re-export、循環依存は`compile:`エラーで拒否する。
`compile(source)`は単一source APIとして保持し、module解決を行わない。fixtureと受入条件は
`apps/examples/multi-file/`、`packages/compiler/test/multi-file-module-composition.test.ts`、
`openspec/specs/multi-file-module-composition/spec.md`にある。

### 5. 基本機能セット(Svelte/Solid水準)のギャップ一覧(2026-07-21 提起、未着手)

「Reactほどではなく、Svelte/Solidぐらいの水準で実用に使われるための
最低限セット」を軸に現状を棚卸しした。§4(props・複数コンポーネント・
複数ファイル)の実装後にも残る/別軸のギャップだけをここに積む。設計判断は
まだしていない。

- **context(ツリー越しの暗黙DI)**: ADR-0027〜0029で解消済み。`createContext`/
  `provideContext`/`useContext`をcompile-timeで静的置換し、root・構造unitのinstance単位へ
  接続する。構造unitの動的provider treeとPromiseLikeの非同期contextも受理するが、runtime
  provider伝播・非同期schedulerは対象外。
- **onDestroy/cleanup**: component instanceの明示的な`unmount()`、top-level
  `use=` actionの`{ destroy }`、ルートcomponentの`onMount` cleanupはADR-0022/0025で
  解消済み。構造unit内action lifecycleは`structural-unit-use-actions`で実装済み。
- **effect(DOM以外への副作用)**: ルートcomponentと構造unit・inline子componentの`effect`は
  ADR-0026で実装済み。effect本体から追跡signalへ書き込む再入、非同期schedulerは対象外で、
  実需が出た時点で別契約を定める。
- **モジュールスコープの共有state(Svelteのstore相当)**: ADR-0030/0037で直接の
  `const name = signal(initial)`と`const name = derived(() => expression)`を
  `compileProject`のmodule共有stateとして実装済み。参照された生成物だけが出力され、
  signalだけがinstance購読を持つ。module共有collection、永続化、request単位SSR分離、
  汎用storeは対象外。
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
    `jsx-type-checking-foundation`)。`packages/compiler/types/jsx.d.ts`(グローバル`JSX`
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

18. 一般用途対応の記録。未完了項目は上記「ヒートマップに向けた実装順序」を優先する。
    1. ~~**優先度P2: component propsとhandlerの型検査**~~ — **完了**(change
       `component-props-handler-type-checking`)。JSDocで宣言したcomponent propsを
       同一ファイルと相対importで検査し、6イベントの型と要素別`currentTarget`を
       `packages/compiler/types/jsx.d.ts`へ追加した。型検査専用fixtureで成功・失敗の両方を固定した。
    2. ~~**module共有stateの派生値**~~ — **完了**(ADR-0037)。module共有signalの
       既存通知経路を使う読み取り専用関数として実装し、共有derivedのcache・schedulerを
       追加しない。**保留: module共有collectionとSSR境界**。request単位分離、永続化、
       collection共有は別契約へ分ける。

## 参考資料

- `STATUS.md` — 現在地・マイルストーン進捗・既知の制約
- `CONCEPT.v3.md` — 現在のプロダクトコンセプト
- `CONCEPT.v2.md` — 旧コンセプト(履歴)
- `docs/adr/0001`〜`0030` — 決定済みの設計判断
- `session/000_ts-rewrite-kickoff-and-m1.md` — 書き直しキックオフの全経緯、
  quixとの比較
- `openspec/specs/` — 実装対象の受入条件の正本
- `packages/bench/listener-strategy.playwright.md` — ADR-0021の実Chromium計測結果
- `packages/bench/todomvc-compiler.results.md` — 性能ベンチ結果(ADR-0005見立ての検証)
- `apps/examples/counter.jsx` — Vite+ buildの手動確認用サンプル
- `apps/examples/todomvc.jsx` / `apps/examples/todomvc.handwritten.js` — ADR-0008/M5
  の目標入力・目標出力フィクスチャ
