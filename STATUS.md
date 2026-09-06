# irisout 実装ステータス

実装の「今」の状態(現在地・マイルストーン進捗・既知の制約)をまとめたもの。
設計判断待ちの論点・次のアクションの計画は `ROADMAP.md` を参照。

## 現在地(2026-09-04・Vite+モノレポ移行)

開発ツールチェーンをVite+へ統合し、`packages/compiler`、`packages/runtime`、
`packages/bench`、`apps/examples`のworkspaceへ分割した(ADR-0016)。テストは
Bun testからVite+ Testへ移行し、exampleはVite pluginがauthored JSXをcompileして
初期HTMLとhydrate専用bundleを生成する。package managerには引き続きBunを使うが、
プロジェクトコードは`bun:test`と`Bun.build`へ依存しない。

## 現在地(2026-09-04・component instance境界)

生成コードを`createComponent()` factoryで囲み、signal / derived、marker、handler、
List runtime、conditional状態、`use=`返り値、`update_*`をroot instanceごとの
クロージャへ移した(ADR-0018)。`mountComponent()` / `hydrateComponent()`は毎回
新しいinstanceを生成して返すため、同じ生成moduleを複数containerで独立して使える。
stateを持つ同じ子componentをroot内で複数回インライン化した場合のDeclId衝突も解消した。

## 現在地(2026-09-05・component unmount / action destroy)

`createComponent()`、`mountComponent()`、`hydrateComponent()`の戻り値に
`unmount()`を追加した(ADR-0022)。instanceはmountまたはhydrateを一度だけ実行し、
unmountはidempotent。unmount時に生成top-level handlerをremoveし、actionの`destroy`を
登録順の逆順で各一回呼び、component-owned DOM、marker Map、List/conditional/template
参照を解放する。unmount後に保持された`update_*`はno-opになる。

`use=`は既存の関数返り値をupdate closureとして維持し、`void | (() => void) |
{ update?: () => void; destroy?: () => void }`を受理する。外部timer/subscription/
listenerの解除はaction作者の`destroy`責務である。list item・conditional branch内の
actionは各factory handleが所有し、keyed reorderでは同じhandleを再利用する。item削除・
branch切替・祖先unit破棄・root unmountでは子unitを先に解放し、actionを一度だけdestroy
する。destroyの例外は残りのcleanup後に最初の例外を再送出する。

actionを含まないunitは従来の`reconcileList()`とfactory経路を使い、action専用runtimeを
importしない。counter generated bundleの固定費は実測5.33xとなったため、golden size
budgetを5.5xへ更新した。

## 現在地(2026-09-06・component lifecycleとinstance context)

ルートcomponentの動きゾーンで`onMount(() => void | (() => void))`を受理する
(ADR-0025)。callbackはmarker収集、handler配線、構造unit初期化、`use=` action初期化の
後にmount/hydrateごと一度実行する。返り値の0引数関数はinstanceが所有し、unmount時に
登録順の逆順で一度だけ実行する。初期化失敗時は登録済みcleanupを回収し、cleanup例外は
残りの処理後に再送出する。

構造unit内の`onMount`はunit factoryが所有し、inline化される子componentはroot scopeなら
root instance、list/conditional scopeならunit factoryへ静的に収集する。ルートcomponent
の`effect(() => void | (() => void))`はADR-0026で実装済みで、callback本体が読むroot
signal/derivedの専用`update_*()`へ依存を接続し、再実行前とunmount時のcleanupをinstanceが
所有する。追跡signalへの書き込みは再入を避けるため拒否する。再mountと汎用lifecycle
registryは未実装である。構造unit内・inline子componentのeffectは、構造unitが再実行と
cleanupを所有する形へ拡張済みである。

instance単位のcontextはADR-0027で実装済みである。トップレベルの
`createContext(defaultValue)`をkeyとして、変数ゾーンの`provideContext(key, value)`と
JSX式の`useContext(key)`を受理する。consumerは最も近いproviderまたはdefault値へ静的に
置換され、root・list item・conditional branchの値式と更新依存はそれぞれの所有instanceへ
閉じる。汎用Map、provider registryは生成しない。構造unitの動的provider treeと非同期contextは
静的置換の範囲で実装済みであり、runtime provider伝播、非同期scheduler、context APIを
動きゾーンやmodule共有stateとして使う形はscope limitである。`onMount`/`effect`/contextを使わない生成物には専用変数・
配線・runtime importを出力しない。

## 現在地(2026-09-05・構造ユニットのDOM範囲所有)

List/conditionalは親要素を更新対象にせず、初期HTMLへ開始・終了コメントアンカーを
出力する。mount/hydrateはアンカー対を専用Mapへ収集し、Listのkeyed reconcileと
conditionalのbranch着脱はその範囲の親ノードと終了アンカーの直前だけを操作する。
そのため静的兄弟要素と複数の構造ユニットを同じ親へ配置できる。構造ユニットを
使わない生成物は従来のmount/hydrate経路を使い、アンカー走査と範囲ヘルパーを出力
しない。unmountは範囲Map、List/conditional参照、component-owned DOMを解放する。

## 現在地(2026-09-05・再帰的構造ユニットとauthoring coverage)

構造ユニットは深さを固定値で制限せず、親factoryのクロージャ内へ再帰的に生成する。
各unit instanceがDOM範囲、ローカル状態、binding cache、Listのkeyed Map、更新処理を
所有する。ネストした条件式・配列式・handlerが現在または祖先unitのローカルsignalを
使う場合は、所有者factoryのupdateへ接続する。branchを再生成するときはunit専用の
binding cacheを新しく作るため、祖先itemのcacheがtemplate初期値を残すことはない。

`apps/examples/todomvc.jsx`は`TodoItem`の`editing() ? <input /> : <span />`を使う
自然なJSXへ変更した。`apps/examples/notes.jsx`はTodoMVCとは別のauthoring coverage
fixtureで、form、tabs、local state、条件分岐、入れ子List、同一ファイルcomponentを
含む。`packages/compiler/test/authoring-coverage.test.ts`がcompile、mount、event、
DOM結果を独立して確認する。

## 現在地(2026-09-05・コンパイラ生成TodoMVC性能計測)

`apps/examples/todomvc.jsx`の現行コンパイラ生成物、`apps/examples/todomvc.handwritten.js`
の手書き基準、`apps/examples/todomvc.react.tsx`のReact productionを、同一Chromiumで
機能試験後に比較した。N=100/1,000/10,000、予熱2回後7回の中央値で、転送量、初期化、
更新、MutationObserverによるDOM変更、JavaScriptヒープ、生成コードの計数を記録した。
手書き基準はコンパイラ生成物ではない。結果と条件は
`packages/bench/todomvc-compiler.results.md`に固定した。

item factoryのmarker参照はイベント配線で再検索せず、factoryの保存済み参照を使う。
生成コードではfactory marker検索5個とイベント登録5個が対応し、初期mount中の
`querySelector`は`2N`、実リスナーは自然な条件分岐の初期branchで`3N+4`だった。

## 現在地(2026-09-05・同一ファイルpropsの式置換、ADR-0023)

同一ファイルコンポーネントのpropsは、呼び出し元の実引数の名前や式の形に
依存せず、呼び出し先のbinding参照を実引数式のクローンへ置換する。メンバー式・
添字式・呼び出し式、三項演算子・二項演算子の内部、ハンドラの式内部を受理し、
値なしの属性(`<Foo enabled />`)は`true`として置換する。props用の実行時オブジェクト
やランタイム機構は追加せず、コンポーネントはコンパイル時に消滅する。

出力は、元のASTを変更していない式では`analyze.ts`のEditリストで
`start`/`end`範囲を再利用し、props置換・識別子変更・ASTノードの合成を含む式では
`ast-codegen.ts`がASTからコード生成する。後者では、置換したノードの位置が
呼び出し元ソースを指す場合や、値なし属性から合成したノードに位置がない場合でも、
呼び出し先の古いソース文字列を切り出さない。props参照の「より大きな式」に
対する制約は削除した。

## 現在地(2026-09-05・相対moduleの複数ファイル合成、ADR-0024)

`compileProject(entryPath)`を追加し、入口から相対`./`/`../`で辿れる`.js`/`.jsx`
moduleを依存順にASTリンクする。named importとdefault import、二段以上の相対importを
受理する。`render(<JSX>)`を持つfunctionは既存のコンパイル時インライン化へ渡し、通常の
functionと初期化済み単純`const`は生成moduleのmodule scopeへ補助宣言として一度だけ出す。
component function、props object、component runtimeは生成しない。直接のmodule scope
`const name = signal(initial)`、`const name = derived(() => expression)`、
`const name = collection(initial, keyOf)`はADR-0030/0037/0039の共有stateとして参照時だけ生成する。

`compile(source)`は単一文字列APIとして維持し、importは受理しない。`compileProject`の
module scopeでは直接signal/derived/collection以外のstate、副作用文、`let`/`var`、分割代入、外部specifier、未解決path、
namespace/side-effect import、dynamic import、re-export、循環依存を`compile:`エラーで
拒否する。補助宣言はstateを呼ばない通常の処理に限る。背景は
`docs/adr/0024-multi-file-module-composition.md`、`docs/adr/0030-module-shared-signal.md`、
`docs/adr/0037-module-shared-derived.md`、`docs/adr/0039-module-shared-collection.md`、
受入条件は`openspec/specs/multi-file-module-composition/spec.md`と
`openspec/specs/module-shared-state/spec.md`に記録した。

`apps/examples/multi-file/`は入口、部品、補助関数、定数を分けたfixtureである。
`packages/compiler/test/multi-file-module-composition.test.ts`は初期HTML、mount、hydrate、
局所signal、条件分岐、List、props、イベント後DOM、Vite build、未対応module構文を実 DOM
で確認する。

## 現在地(2026-09-04・List最小ランタイム第1段階)

CONCEPT.v3への移行に伴い、List更新を共有最小ランタイムへ切り出した
(ADR-0015)。List marker ID / key値 / item内binding IDの3段アドレスを分離して
保持し、値が変化したbindingだけを実DOMへ反映する。keyed reuse、追加、削除、
並べ替えは`reconcileList()`が担当し、順序が同じDOM要素は再挿入しない。
Listを使わない生成物にはList helperのimport自体を出力しない。

keyed collection APIを追加した(ADR-0019)。`collection(initial, keyOf)`は
`signal()`と同じ読み取り・全体setterに加えて`collection.update(key, updater)`を持つ。
直接の`collection().map()`は変更itemのhandleをMapから引いてO(1)で通知し、同じcollectionを
描画する複数ListとList以外の依存markerも更新する。通常setter、派生した配列式、ネストListは
従来どおり全体reconcileへフォールバックする。

## 現在地(2026-09-04・同期更新バッチ)

ハンドラ・action・追跡された動きゾーン関数の1同期スコープが複数root signalを書き、
同じmarkerへ依存する場合だけ、静的なwrite set/依存グラフから専用batchを生成する
(ADR-0020)。batchは全書き込み後にderivedを一度ずつ再計算し、markerの和集合を
重複なしで反映する。単一root・異なるmarker・同じsignalの複数回書き込みでは既存の
`update_<name>()`を使い、未使用のbatch関数は出力しない。

`collection.update()`のkeyed direct通知は維持し、別rootと共有markerを持つbatch内だけ
instance専有の深さカウンタでdirect通知を遅延する。ローカルsignalのfactory
`update()`、Listのkey照合/順序調整、公開batch APIやmicrotask schedulerは変更しない。
イベント配線は実Chromiumで`direct`、`delegated`、`capture`、`adapter`を、
`click`、`change`、`input`、`keydown`、`dblclick`、`blur`のfixtureで比較した
(ADR-0021)。delegated/capture/adapterはリスナー数とJavaScriptヒープで有利だったが、
delegatedは`blur`を処理できず、captureは`currentTarget`と段階を変え、adapterは
event objectの同一性を失った。native eventの意味を保つためproduction既定はdirectを
維持する。collection構造操作APIは引き続き未着手である。

## 現在地(2026-09-06・JSX型検査)

authored `.jsx` の型検査基盤を実装(change `jsx-type-checking-foundation`、
ROADMAP 次のアクション10)。`@irisout/compiler/jsx`でグローバル`JSX`namespace
(`Element`・`IntrinsicElements`・`IntrinsicAttributes`)と`signal`/
`derived`/`render`のグローバル関数シグネチャを宣言し、`apps/examples/`配下
専用の`apps/examples/tsconfig.json`(`allowJs`+`checkJs`+`jsx: "preserve"`、
`types: ["@irisout/compiler/jsx"]`)で`apps/examples/*.jsx`を型検査対象にした。ルートの`tsconfig.json`
は無変更 ― `allowJs`/`checkJs`をルートへ足すと
`apps/examples/todomvc.handwritten.js`(`packages/compiler/test/todomvc-handwritten.test.ts`が
importする比較用の手書きJS、型検査対象外)まで巻き込まれ、既存の
`@ts-expect-error`抑制が壊れるため、examples専用の別プロジェクトに
切り出した。あわせて`node_modules/@types/react`が自動包含され`JSX`
namespaceを上書きする踏み台バグを明示した型定義だけを読み込む設定で解消した(実装前調査
未発見の計画外の落とし穴)。ADR-0011が先送りしていた`use=`のJSX型定義
(design.md Decision 6)も同時に解消した。

属性名は意図的に緩い(共通属性`key`/`use`/`onXxx`/`children`のみ明示し、
他は`string`キーで許容 ― コンパイラ自身が host 属性名をホワイトリスト化
していないため)。`apps/examples/tsconfig.json`は`strict: false`(authored
`.jsx`は型注釈を書けない素のJS構文なので、strictを掛けるとハンドラ引数の
ほぼ全てが implicit any でエラーになり実用にならない)。型が通ることと
実行時に`compile()`が受理することは別軸のまま ― 型はコンパイラの
scope limit判定を代替しない(例: 字句スコープ外のsignal参照は別途拒否される、
下記制約参照)。

change `component-props-handler-type-checking`で、JSDocを付けたコンポーネントの
必須props、余分なprops、値型を同一ファイルと相対importの呼び出し箇所で検査する。
`.jsx`は維持し、型宣言はコメントとしてコンパイル時に消える。JSDocのない
コンポーネント引数は`strict: false`のため従来どおり`any`であり、自動推論はしない。

`onClick`/`onDblClick`、`onKeyDown`、`onInput`、`onChange`、`onBlur`は、それぞれ
`MouseEvent`、`KeyboardEvent`、`InputEvent`、`Event`、`FocusEvent`へ型付けする。
直接登録される要素を`currentTarget`へ反映し、子要素になり得る`target`はDOM標準型の
まま維持する。その他の`onXxx`は関数だけを受理し、イベント種別は保証しない。
`types/test/**/*.jsx`の成功例と`@ts-expect-error`付き失敗例で型が緩む回帰も検出する。

## 現在地(2026-07-21)

同一ファイル内の複数コンポーネント合成を実装(ADR-0014、change
`same-file-component-composition`、ROADMAP §4・UNRESOLVED-04 解消)。
`<Component/>`参照を`findRootComponent`より前の独立した前処理パス
(`packages/compiler/src/compiler/inline-components.ts`)でコンパイル時ASTインライン化する
― `compileComponent`/`renderElement`は無変更のまま単一コンポーネント
前提で動く。propsはshorthand分割代入のみ対応するコンパイル時識別子
置換(実行時オブジェクトなし)。リストアイテムへインライン化された
コンポーネントの変数ゾーンは「ローカルsignal」(factory クロージャ専有、
module scopeに一切出ない)になり、同一unitと祖先unitのテキスト/属性・
構造unit・handlerからの依存を所有者factoryへ接続する(下記制約参照)。名前衝突は
検出時のみ対応(signal/derived宣言名・動きゾーン関数名とも、衝突した側を
コンポーネント名で接頭辞化してリネームする)。

## 現在地(2026-07-19)

TypeScript書き直しは M6(全マイルストーン横断の no-wrapper 検証)まで完了。
「使ってもらえる閾値」(M5+`use=`)に到達済み(proposal参照)。`legacy/`(元のJS実装)は参照専用で以後メンテナンスしない。

2026-07-18: テキスト式値が初期 HTML へ**未エスケープで焼き込まれる注入穴**を
発見・修正(計画外バグ、change `escape-initial-html`)。
`signal("<img onerror=...>")` が `dist/index.html` に生 HTML として注入され、
かつ実行時更新(`textContent`)と表示が食い違っていた。ビルド時実行にのみ
`__esc__`(`&`/`<` のエンティティ化)を注入して修正。生成コード・ランタイムは
不変(ADR-0004)。

2026-07-18: mount/hydrate 時のマーカー存在検証を追加(change
`loud-hydration-mismatch`)。DOM と生成コードの不一致は黙って no-op に
ならず、欠落 ID を列挙して throw する。この検証はランタイム固定費として
`dist/app.js` に乗るため、サイズ予算係数を 3x → **4x** へ明示的に変更
(生成コード側の肥大化ではない。係数を締め直すのは M6 のスコープ)。

2026-07-19: 動的属性バインディングを実装(ADR-0012、change
`dynamic-attribute-bindings`、UNRESOLVED 02/03 解消)。式コンテナ値の host
属性を受理し、`checked`/`value` はプロパティ反映・他は setAttribute。
ユニット内の属性式はテキストと同じ scope limit(追跡 signal 参照は拒否)。
あわせて、構造ユニットと同じ親要素のハンドラが黙って捨てられる計画外バグを
発見・修正(親要素専用のマーカー id へ配線)。

2026-07-19: ハンドラ/action 本体からの動きゾーン関数呼び出しの追跡を実装
(ADR-0013、change `cross-function-handler-writes`、ROADMAP 論点0 解消)。
`onClick={() => toggle(todo.id)}` のような引数つき補助関数呼び出しで
`toggle` 本体の signal 書き込みが解析されず **update\_*() が黙って落ちて
いた** M2 以来のバグを解消。callee の binding が動きゾーンの function 宣言と
同一なら本体を再帰解析(visited-set・深さ制限なし)し、`writeDeclIds` を
呼び出し元へ合流、書き換え済み関数を authored 名のままモジュールスコープへ
1回だけ emit する。あわせて新しい scope limit を2つ追加(下記制約参照)。

## マイルストーン表

| M         | 内容                                                                           | 状態     | 備考                                                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1        | スキャフォールド、signal/derived、テキストマーカー                             | **DONE** | `0155e85`                                                                                                                                                                                                                        |
| M2        | イベントハンドラ、書き込みトリガー更新                                         | **DONE** | `810bc83`→`645a820`                                                                                                                                                                                                              |
| M3        | ブラウザビルドターゲット(hydrate/mount分割 + `apps/examples/vite.config.ts`)   | **DONE** | `a2905c8`、Vite+移行後はADR-0016のbuild経路                                                                                                                                                                                      |
| M4        | 静的host要素属性                                                               | **DONE** | `9829f88`、change `m4-static-host-attributes`                                                                                                                                                                                    |
| M4.5      | authoring APIゾーン化(ADR-0008)                                                | **DONE** | change `authoring-api-zones`。render()マーカー・識別子参照ハンドラ・ゾーン配置強制                                                                                                                                               |
| M5        | list/conditional factory closures、1階層のみ(ADR-0005の新実装)                 | **DONE** | change `m5-list-conditional-factory-closures`。ネストした構造ユニット(06/07)は据え置き                                                                                                                                           |
| M5.5      | ネストした構造ユニット(条件分岐の中のリスト/リストアイテムの中の条件分岐)      | **DONE** | change `recursive-structural-authoring`。任意の深さ、unitごとの状態/cache、祖先local signalの更新接続                                                                                                                            |
| `use=`    | 要素へのaction接続(ADR-0011)                                                   | **DONE** | `use-action-impl` + `structural-unit-use-actions` + ADR-0022。top-level、list item、conditional branchをfactory単位で初期化・更新・破棄。関数updateと`{ update?, destroy? }`、component `unmount()`を実装                        |
| M6        | 全マイルストーン横断のno-wrapper検証                                           | **DONE** | change `m6-no-wrapper-verification`。全機能同居フィクスチャで no-wrapper・import面・実DOM動作を固定(`test/no-wrapper.test.ts`)。サイズ予算係数はADR-0022のlifecycle固定費を含む5.5x(実測5.33x)。締め直しはminify最適化時に再検討 |
| 合成      | 同一ファイル内の複数コンポーネント合成(ADR-0014)                               | **DONE** | change `same-file-component-composition`。コンパイル時ASTインライン化、root scope + list itemのみ、children/slot・再帰は未対応(下記制約参照)                                                                                     |
| 分割      | 相対moduleの複数ファイル合成(ADR-0024)                                         | **DONE** | `compileProject(entryPath)`、AST bindingリンク、依存順、静的import検証、Vite fixtureを実装。外部module・dynamic import・cycle・re-exportは対象外                                                                                 |
| Batch     | 同期スコープ内の共有marker更新(ADR-0020)                                       | **DONE** | 複数root write時だけ専用batchを生成。公開batch API・scheduler・collection構造操作は対象外。イベント配線はADR-0021でdirectを採用                                                                                                  |
| Context   | instance単位context(ADR-0027)                                                  | **DONE** | `createContext`/`provideContext`/`useContext`を静的置換。root・list item・conditional branchの所有単位へ接続し、未使用時の生成物は増やさない                                                                                     |
| Heatmap 3 | 同期解析の派生値連鎖・構造unitのroot依存・条件分岐内の状態付き子部品(ADR-0033) | **DONE** | `apps/examples/heatmap.jsx`、回帰試験を追加                                                                                                                                                                                      |
| Heatmap 4 | 外部解析依存、CSS・辞書URL・Worker資源のVite境界(ADR-0034)                     | **DONE** | `@libraz/suzume`、接頭辞付き本番build、未使用外部binding除外を確認                                                                                                                                                               |
| Heatmap 5 | Worker解析、連続入力、文字確定、キーボード移動、性能測定(ADR-0035)             | **DONE** | 300段落・24,790文字の実Chromium測定、対応範囲と完了基準を`packages/bench/heatmap.results.md`へ記録                                                                                                                               |
| Heatmap 6 | 診断、型定義、別アプリ導入、自動検査、配布形式(ADR-0036)                       | **DONE** | 元ファイル・行・列付き診断、`@irisout/compiler/jsx`、別workspaceアプリのbuild試験、CI、Apache-2.0を追加                                                                                                                          |
| Shared 1  | module共有derivedの受理と依存更新(ADR-0037)                                    | **DONE** | 共有signalの通知経路、derived依存グラフ、未使用出力の除外、読み取り専用検査を追加                                                                                                                                                |
| Shared 2  | module共有collectionの受理とList更新(ADR-0039)                                 | **DONE** | 共有accessor、key selector、instance購読、List key照合、未使用出力の除外を追加                                                                                                                                                   |

## 既知の制約(現時点のcodegenの限界)

2026-09-06のヒートマップ調査で、非同期ハンドラから`async`が落ちて不正な生成物に
なる問題、ハンドラ内のPromiseコールバックによる状態更新がDOMへ反映されない問題、
派生値を参照する`derived`が拒否される問題を再現した。第2段階で非同期更新を、第3段階で
派生値の連鎖を実装し、回帰試験と代表アプリで確認した。

ロードマップ第1段階の検査と編集反映は実装済みである。`bun run check`と`bun run typecheck`
が`apps/examples/tsconfig.json`のJSX型検査を実行し、`@irisout/vite-plugin`が
`compileProject()`の依存pathを監視して入口・相対moduleの変更時に全体再読み込みを送る。
構文エラー時は直前の正常結果を保持し、修正後の変更で復帰する。

## 第3段階の実装結果(2026-09-06)

`derived`の依存グラフを循環検査し、root signalから到達する派生値を依存順に再計算する。
リストと条件分岐の本文・属性からroot signal/derivedへの依存を所有factoryへ接続する。
条件分岐内の状態付き子部品は、ブランチ全体を0引数arrowのblockへ包み、局所状態と
ライフサイクルをbranch factoryへ置く。`apps/examples/heatmap.jsx`と回帰試験で確認した。

## 第4段階の実装結果(2026-09-06)

`compileProject()`は外部moduleとVite資源importを生成moduleへ残し、外部moduleの内部を解析
しない。使用される外部bindingだけを出力し、CSS、`?url`、`?worker`の資源は依存一覧へ加える。
`@libraz/suzume`、WebAssembly URL、用語辞書URL、Worker入口、CSSをヒートマップ例へ接続し、
ブラウザ専用の初期化と破棄を`onMount()`とcleanupへ置いた。通常buildと`/heatmap/`接頭辞
付きbuildで資源URLを確認した。Workerによる本文解析、連続入力、古い結果の破棄は第5段階で実装した。

## 第5段階の実装結果(2026-09-06)

`apps/examples/heatmap.worker.js`でSuzumeとWebAssemblyを生成し、本文を要求番号付きで解析する。
画面側は最新要求だけを採用し、Workerと処理の失敗を表示する。`compositionstart`から
`compositionend`までは要求を送らず、確定後に一度だけ解析する。unmount時はイベント購読を外し、
破棄要求を送り、Workerを終了する。

各段落に指標値を文字で表示し、`aria-live`、`tabIndex`、`aria-selected`、上下左右の矢印キーを
追加した。`packages/bench/heatmap.playwright.ts`で本番生成物を実Chromiumへ読み込み、3、30、
100、300段落を計測した。最大の300段落・24,790文字ではWorker解析829.8ms、入力から表示850.8ms、
表示更新の差分21.0ms、ページ側JavaScriptヒープ増分432,568B、キーボード応答0.4msだった。
対応範囲は300段落・25,000文字、入力から表示1,000ms、表示更新の差分100ms、ページ側ヒープ32MiB、
キーボード応答16msを完了基準とする。詳細は`packages/bench/heatmap.results.md`とADR-0035へ記録した。

## 追加実装結果(2026-09-06・module共有derived、ADR-0037)

`compileProject()`は直接の`const name = derived(() => expression)`をmodule scopeの共有derivedとして
受理する。参照されたderivedは生成moduleへ一つだけ出力し、共有signalの更新時は各instanceの
既存`update_*()`から関数を読み直す。derived専用のcache、購読registry、schedulerは生成しない。
module共有derivedの呼び出しは読み取り専用で、引数付き呼び出しは`compile:`エラーになる。
未使用のderivedと、その依存だけの共有signalは生成物へ出力しない。collection共有と永続化は
別契約であり、request単位SSR分離はADR-0038で現行版の対象外と定めた。

## 追加実装結果(2026-09-06・module共有collection、ADR-0039)

`compileProject()`は直接の`const name = collection(initial, (item) => key)`をmodule scopeの
共有collectionとして受理する。参照されたcollectionは生成moduleへ一つだけ出力し、配列の置換と
`update(key, updater)`を現在のmounted instanceへ同期通知する。Listのkeyed DOM状態とbinding
cacheは各instanceが所有し、unmount時に購読を解除する。直接形でないcollection宣言は
`compile:`エラーになる。

module共有collectionの更新は各instanceの既存`update_*()`からListを再調整する。module collection
ではinstance専有collectionのitem直接更新経路を使わない。未使用のcollectionと、その依存だけの
共有stateは生成物へ出力しない。永続化とrequest単位SSR分離は別契約である。

## 現在地(2026-09-06・client buildとSSR境界、ADR-0038)

`compileProject()`とVite連携は、ビルド時に一度生成した静的HTMLをブラウザでmountまたはhydrate
するclient buildの入口である。`initialHtml`を要求ごとのSSR結果とは扱わず、要求ごとの入力や
state factory、サーバーtargetは現行版へ追加しない。request SSRが必要になった場合は、要求ごとの
state所有とhydrate引き継ぎを別のADRとOpenSpecで定める。

## 現在地(2026-09-06・利用者向け開発環境)

コンパイル時の失敗を`CompileDiagnostic`へまとめ、入口または対象moduleのファイル名、行、列を
エラーメッセージへ付ける。公開入口は`@irisout/compiler/diagnostics`であり、Vite連携の失敗も
同じ形式を使う。生成コードから元コードへ戻るソースマップは未実装である。

JSX型定義は`@irisout/compiler/jsx`としてcompiler packageから参照できる。`apps/examples`と
`examples/consumer-app`の`tsconfig.json`がこの入口を使う。`bun run check`には両方の型検査が含まれ、
`bun run test`には別ディレクトリのVite build試験が含まれる。GitHub Actionsの`.github/workflows/ci.yml`
では`bun install --frozen-lockfile`、`bun run check`、`bun run test`、`bun run build`を実行する。

配布形式はGitリポジトリ内のprivate workspaceとし、npm等への公開は行わない。コードのライセンスは
Apache License 2.0で、ルートの`LICENSE`と各配布対象packageの`license`欄に記載する。外部解析依存の
ライセンスは依存元の記載に従う。導入手順は`examples/consumer-app/README.md`で確認できる。

- **ルートコンポーネントは1つだけ**: `compile()`は「他から一度も参照
  されないトップレベル関数」がちょうど1つであることを要求し、そうで
  なければcompile error(`packages/compiler/src/compiler.ts`のscope limit)。
- **`compile(source)`のトップレベルは関数宣言とcontext keyだけ**(2026-07-18、change
  `scope-limit-coverage`): Program直下は関数宣言(`export`付き含む)と
  `const Name = createContext(defaultValue)`以外(import・副作用式等)を`scope limit`で
  拒否する。`const [a] = signal(0)`
  のような分割代入宣言子も拒否する。ビルド時実行の例外は
  `compile: build-time execution failed:`(`cause`付き)に包まれる。
- **`compileProject(entryPath)`のmodule境界**(ADR-0024/0030/0034/0037〜0039): 相対`.js`/`.jsx`の静的
  named/default importを解析して連結する。外部moduleの静的named/default/namespace importと
  CSS、`?url`、`?worker`などの資源importは解析せず生成moduleへ残し、使用されないbindingは
  出力しない。相対資源の実pathは依存一覧へ含める。module scopeの直接`signal`/`derived`/`collection`は
  共有stateとして受理し、その他のstate、副作用文、`let`/`var`、分割代入、未解決の相対path、
  相対`.js`/`.jsx`のside-effect import、dynamic import、re-export、循環依存は`compile:`エラーで
  拒否する。
- **複数インスタンスは対応済み**(ADR-0018): 同じ生成moduleを複数containerへ
  mount/hydrateした場合と、stateを持つ同じ子componentをroot内で複数回使う場合の
  どちらもstate・marker・handler・構造ユニット状態が独立する。1つの
  `createComponent()`戻り値を複数rootへmountする使い方は保証しない。instanceは
  mount/hydrateを一度だけ実行でき、`unmount()`後の同instance再mountは拒否する。
- 静的host属性はM4、動的(式コンテナ)host属性値はADR-0012(change
  `dynamic-attribute-bindings`)で実装済み。attribute/property の使い分けは
  固定表(`checked` = booleanプロパティ、`value` = 文字列プロパティ、他は
  `setAttribute`)。リスト・条件分岐内の属性式がルートsignal/derivedを参照する
  場合は、依存を親markerへ持ち上げて所有者factoryのupdateへ接続する。同一unitまたは
  祖先unitで宣言されたlocal signalへの依存も接続する(UNRESOLVED-04解消)。
- **リスト(`.map()`)・条件分岐(三項/`&&`)は再帰的に実装済み**
  (change `recursive-structural-authoring`)。構造unitは任意の深さでfactoryへ
  展開され、各instanceがDOM範囲、local state、binding cache、Listのkeyed Map、
  update処理を所有する。現在または祖先unitのlocal signalを条件式・配列式・
  handler・bindingから使う場合は、所有者factoryのupdateへ接続する。
  - リストアイテム本体・条件分岐ブランチ本体の直接テキスト/属性で**ルート**
    signal/derivedを参照できる。item要素のフィールド参照は追跡対象外なので素通りする。
    ネストunitの条件式・配列式でroot signalを参照する依存も外側markerへ合流する。
  - 字句スコープ外の別unit local signalをネストunitが参照する場合は、
    `compile: ... (scope limit)`で拒否する。local DeclIdをrootの
    `signalToMarkers`へ漏らさない。
  - `.map()`のコールバックのブロック本体(`=> { ... }`)は、
    「signal()/derived()宣言・動きゾーンのfunction宣言 + 最終return」の形のみ
    受理する。それ以外の文を含むブロック本体は引き続き`scope limit`。
  - リストアイテムに`key`属性がない場合、または`key`が追跡対象signalを参照する
    場合は`scope limit`。
- **フィルタ全件除外時の状態破棄**(M5.5、design.md Decision 2): 条件分岐
  ブランチにネストしたリストは、外側の条件分岐が選択を切り替えてリスト
  全体を非マウントにした瞬間、keyed Map・ローカル状態が(フィルタで
  非可視だっただけのアイテムも含めて)全件破棄される。「フィルタ除外時の
  状態保持」保証は、そのリスト自身がDOM上にマウントされ続けている間に
  限られる(spec「配列脱落とフィルタ除外の区別」の境界条件)。
- ハンドラ(inline arrow / 識別子参照の function宣言 どちらも)のブロック
  本体は式文 / `const`・`let` / `if` / 裸の `return`に限る(ADR-0009)。actionの
  初期化・destroy本体だけは例外検証のため`throw`も明示的に受理する。第1仮引数
  (イベントオブジェクト)は authored 名のまま受け渡す
  が、分割代入・第2引数以降は `scope limit` で拒否する。ループ・
  `try`/`switch`・関数/クラス宣言・`var`・値を返すハンドラの`return`、および
  ソース順で追跡書き込みより後ろの`return`も同様に`scope limit`で拒否する
  (D3: 末尾`update_*()`の取りこぼしを防ぐため)。`throw`は初期化・cleanupの
  例外経路を検証するために受理する。
- **ハンドラ/action 本体からの動きゾーン関数呼び出しは追跡する**(ADR-0013、
  change `cross-function-handler-writes`)。callee の binding が動きゾーン
  (render 後)の function 宣言と同一なら本体を再帰解析(visited-set・深さ
  制限なし)して書き込み先を呼び出し元へ合流し、書き換え済み関数を authored
  名のままモジュールスコープへ1回だけ emit する。追跡呼び出しは D3 の
  「追跡書き込み」として数え、その後ろの `return` を拒否する。以下は
  `scope limit`:
  - binding は解決できるが動きゾーンの function 宣言でない呼び出し(仮引数・
    ハンドラ内ローカル束縛・変数ゾーン由来の識別子を関数として呼ぶ)。
    binding 未解決(グローバル)は従来どおり素通し。
  - 追跡対象として呼ばれる関数の authored 名が生成側予約名(`update_*` /
    `__` 接頭辞)と衝突する場合(黙ってリネームしない)。
  - なお `onClick={toggle}`(識別子参照ハンドラ)は従来どおり本体を
    マーカーごとにインライン展開する。同じ関数が参照と呼び出しの両方で
    使われると本体が重複して出力されるのは許容(統一は実需が出てから)。
- **`use={fn}`アクション(ADR-0011/0022、`structural-unit-use-actions`)はtop-level要素、
  list item、conditional branchで実装済み**。関数返り値は既存のupdate closure、object
  返り値は`{ update?, destroy? }`として扱う。factory handleがaction resultを所有し、
  keyed reorderでは再初期化せず、item削除・branch切替・祖先unit破棄・root `unmount()`で
  destroyを一度だけ呼ぶ。子unitを先に解放し、例外があっても残りのcleanupを続ける。
  以下は明示的なscope limit・別changeへの先送り:
  - reactive paramsは未実装。actionの引数をsignal更新で再評価せず、必要なら別の実需と
    代表fixtureで判断する。
  - 1要素への複数actionは未実装。`use`属性は一要素一つのままとする。
  - ルートcomponentの`onMount`(ADR-0025)は実装済み。構造unit内・inline化される
    子componentの`onMount`と構造unit内の`onMount`は実装済み。ルートcomponentの`effect`と
    構造unit・inline子componentのeffectはADR-0026で実装済みであり、各ownerが再実行前と
    破棄時のcleanupを持つ。component instanceのcleanupとunit action lifecycleは解消済み。
  - instance context(ADR-0027〜0029)は実装済み。context keyはトップレベル`const`、providerは
    component変数ゾーンまたは構造unitへインライン化されたproviderに限る。consumerは
    JSX/式解析時に静的置換され、構造unitの動的provider treeとPromiseLikeの非同期contextも
    受理する。runtime provider伝播、非同期scheduler、動きゾーンでのprovider宣言は対象外。
    module共有signal/derived/collectionはADR-0030/0037/0039の直接形だけを
    `compileProject`で受理する。
  - action本体のconcise arrow(単一式)にネストしたリスナー等がある場合、
    その内部の書き込みに対する`update_*`挿入位置は本体全体の実行時点に
    まとまる(リスナー発火時ではない)。ブロック本体は正しく分離される
    (`packages/compiler/src/compiler/analyze.ts`の`analyzeActionExprScope`コメント参照)。
- **非同期handlerのsignal更新は実装済み**(ADR-0032): `async`を生成wrapperへ保持し、
  `await`後の直接書き込みをhandler本体末尾で更新する。Promiseの`.then()`に渡す入れ子
  callbackは個別の関数スコープとして解析し、成功callback・拒否callbackの書き込み後に
  更新を呼ぶ。同期handlerの開始状態はcallback登録後に更新し、完了後の結果・失敗状態は
  各callbackの実行時に更新する。`try`/`catch`/`finally`、ループ、`switch`、値を返す
  handlerなど更新位置を静的に決められない経路は`scope limit`で拒否する。要求の競合、
  古い結果の破棄、Worker、画面破棄後の応答はヒートマップ例のアプリ側で実装済みである。
- **コンポーネント合成はコンパイル時に消える**(ADR-0014、ADR-0024)。同一ファイルの
  合成はroot scopeとlist itemへインライン化し、別ファイルの合成は
  `compileProject(entryPath)`が相対moduleをリンクして同じ経路へ渡す。以下は明示的な
  scope limit・別changeへの先送り:
  - `<Component>children</Component>`(children/slot)は`scope limit`。
    実需が出るまで対応しない(ADR-0014決定7)。
  - 自己/相互再帰参照(`function A() { render(<A/>) }`等)は
    `scope limit`(展開中コンポーネント名のvisited集合で検出)。
  - propsは`function Foo({ a, b })`形のshorthand分割代入のみ対応。
    非shorthand(`{ a: x }`)・複数仮引数・spread propsは`scope limit`。
  - コンポーネントを構造ユニット(list item)と条件分岐ブランチへインライン化できる。
    条件分岐内の状態付き子部品は、ブランチ全体を0引数arrowのblockへ包み、
    ローカルsignalとライフサイクルをbranch factoryへ移す。children/slotは対象外。
  - propsは`function Foo({ a, b })`形のshorthand分割代入のみ対応する。参照の
    bindingがpropsに対応する場合、実引数が識別子・メンバー式・添字式・呼び出し式
    のいずれでも、三項演算子・二項演算子・メンバー式・呼び出し式・ハンドラの
    内部を含めてASTから置換する。値なし属性(`<Foo enabled />`)は`true`として
    扱う。非shorthand(`{ a: x }`)・複数仮引数・spread propsは`scope limit`。
  - 名前衝突: ルートスコープへ統合されるsignal/derived宣言名・動きゾーン
    関数名は、呼び出し元の既存識別子と衝突する場合のみ、衝突した側を
    コンポーネント名で接頭辞化してリネームする(例: `TodoItem_count`,
    `TodoItem_inc`)。衝突しない場合はauthored名のまま出力する。
  - `compileProject`のmodule helperは純粋な補助処理を前提にする。module scopeのstateは
    ADR-0030/0037/0039の直接signal/derived/collectionだけを共有stateとして受理し、汎用storeは
    追加しない。componentのstateは入口側へ置いてpropsで渡す。
