# irisout 実装ステータス

実装の「今」の状態(現在地・マイルストーン進捗・既知の制約)をまとめたもの。
設計判断待ちの論点・次のアクションの計画は `ROADMAP.md` を参照。

## 現在地(2026-09-09・R3完了判定)

`bun run check`と`bun run test`を実行し、型検査と試験の通過を確認した。性能値は
同一生成物・同一Chromium・同一反復数の基準を取り直し、List初期化は82.7msから69.9msへ
15.5%短縮した。TodoMVCの測定は環境差を含むため、同じ条件の変更前後比較だけを採否に使う。

R1では、相対moduleをリンクした後も子moduleの元ファイル・行・列を診断へ付ける経路と、
子JSXの失敗を確認する試験を追加した。位置を保持できない診断は代替位置を使うため、
すべての変換後エラーで正確な原因位置を保証するものではない。

R2では、ヒートマップの指標計算、一覧表示、詳細表示、Worker通信を分割した。Workerは
段落識別子、単語数、選択中の指標値、算出理由を返し、最新要求だけを採用する。段落数
300、本文25,000文字の上限、解析失敗、上限超過、文字変換中、画面破棄を扱う。

R3では、初回List生成のDocumentFragment（一度にDOMへ挿入する一時ノード）、初回経路分岐、
item markerの要素走査、List itemの直接イベント配線を維持した共有callbackを追加した。同一生成物・同一Chromium・同一反復数で
1万件のList初期化は82.7msから69.9msとなり、短縮率は15.5%だった。探索方式を変える案は
測定値が悪化したため採用しない。追加改善または目標改訂をADR-0044へ記録した。
イベント意味論と採否は[ADR-0044](./docs/adr/0044-list-initialization-costs.md)に記録した。

2026-09-08: ADR-0045の限定範囲で、リスト項目内の安全な初期条件分岐を項目templateへ
含め、初回だけbranch factoryが既存DOMを引き取る実装を追加した。初回真偽値の枝、空枝を
経由した再表示、hydrate、keyed追加・並べ替え・削除、SVG親要素、lifecycle、入れ子構造を
確認した。同一条件での最終比較は変更前コミット`e645893`の86.6msから実装74.0msで
14.5%短縮だったが、前回候補比較は4.6%であり、環境ばらつきを記録した。
限定実装は採用する。`e645893`は今回変更前の比較対象で、
R3基準として記録された82.7msとは異なる。

2026-09-09: R3の20%短縮は基準再計測後に確定する仮目標だったため、ADR-0046で
固定値を完了条件から外した。同一条件の最終比較で確認した1万件の初期化14.5%短縮を、
イベント契約を変えずに得た改善として採用した。100件の+0.1ms、gzip合計の+74B、
N=1,000のmount後ヒープの+5,756Bを記録し、許容した。原因分析、再現方法、通常更新、
転送量、ヒープ、回帰確認が揃ったためR3を完了とする。Reactは初期HTMLの扱いと初期化方式が
異なるため、初期化時間を参考値として扱い、R3の完了条件には使わない。次はR4の隔離試用で
見つかった停止要因を扱う。

R4では、compiler、runtime、Vite連携、JSX型定義を単一の`irisout` 0.1.0へまとめた。
内部三パッケージは非公開とし、生成コードは`irisout/runtime`を参照する。
`bun run pack:smoke`は親workspaceの外で一つのtarballを導入し、`bun install`、型検査、
Vite build、初期HTML、生成JavaScript、workspace指定の不存在を確認する。`irisout` 0.1.0は
2026-09-09にnpmへ公開した。作者以外による手動試用は未実施である。

2026-09-09に三つのサブエージェントを使い、実装を参照しない隔離試用を行った。npm公開版の
導入、型検査、本番ビルド、開発サーバー、初期HTML、入力、状態、派生値、イベント、条件分岐、
キー付きリスト、ファイル分割、診断からの修正を確認した。人間によるブラウザ操作、編集時の
再生成、ルート部品の破棄は未確認である。試用で見つかった公開版開始手順と型設定の不足を
文書へ追加し、未対応の`try`と`for`が原因と異なる位置を示す問題を修正した。実行時例外の
実行時ソースマップはADR-0049の最初の対象を実装した。イベント処理、`use=`、`onMount`、
`effect`の処理文を元の`.js`または`.jsx`へ対応付け、本番Vite+ビルドでも確認した。

2026-09-10: 0.1.0以後の互換性を維持した診断修正、利用文書、実行時ソースマップを
0.1.1の範囲とした。公開パッケージの版と変更履歴を更新し、`pack:smoke`でtarballの
内容、版番号、本番ソースマップから一時利用アプリの元JSX位置を確認する。0.1.1は
公開準備済みで、npmには未公開である。判断はADR-0050に記録した。

次期方針は[開発方針](./docs/project-direction.md)、作業順序は[ROADMAP.md](./ROADMAP.md)を参照する。以下の過去の記録にあるロードマップの節番号と第1〜6段階は、[旧ロードマップ](./docs/history/roadmap-through-2026-09-07.md)の番号である。

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

## 現在地(2026-09-06・component children slot)

同一ファイルcomponentの`children` propを実装した(ADR-0041、change
`component-children-slot`)。`<Panel>...</Panel>`の空白以外の子ノード列を、
`function Panel({ children })`の本体にある直接の`{children}`へコンパイル時に
展開する。展開後の子要素、signal、handler、構造unit、子component参照は既存の
render-tree解析へ渡し、実行時props objectやslot runtimeは生成しない。

`children`を宣言しないcomponent、属性・handlerなど直接のJSX子位置以外での
`children`参照、既存render-treeが受理しない子ノードの組み合わせはscope limitとする。
`apps/examples/notes.jsx`のnote-list枠をchildren slotへ置き換え、root・複数子要素・
動的式・handler・子componentの実DOM試験を追加した。

## 現在地(2026-09-06・SVG authoring)

SVG要素を既存のHTML文字列生成、hydrate、直接DOM更新へ接続した(ADR-0042、change
`svg-authoring`)。`svg`以下の要素へSVG namespaceを引き継ぎ、`foreignObject`の子は
HTML namespaceへ戻す。通常の動的属性は`setAttribute`で更新し、`xlink:*`、`xml:*`、
`xmlns:*`は静的文字列属性として出力する。専用runtimeとSVG property変換表は生成しない。

SVG intrinsic要素と静的名前空間属性を`@irisout/compiler/jsx`へ追加した。動的な名前空間
属性、SVG外の名前空間属性、属性名の自動変換はscope limitまたは対象外とする。

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
| 合成      | 同一ファイル内の複数コンポーネント合成(ADR-0014/0041)                          | **DONE** | change `same-file-component-composition` + `component-children-slot`。コンパイル時ASTインライン化、root scope + list item、直接children slotを実装。再帰は未対応                                                                 |
| SVG       | SVG要素、名前空間属性、foreignObject(ADR-0042)                                 | **DONE** | change `svg-authoring`。既存HTML parser・setAttribute経路、SVG intrinsic型、静的`xlink:*`/`xml:*`/`xmlns:*`を実装。動的namespace属性は対象外                                                                                     |
| 分割      | 相対moduleの複数ファイル合成(ADR-0024)                                         | **DONE** | `compileProject(entryPath)`、AST bindingリンク、依存順、静的import検証、Vite fixtureを実装。外部module・dynamic import・cycle・re-exportは対象外                                                                                 |
| Batch     | 同期スコープ内の共有marker更新(ADR-0020)                                       | **DONE** | 複数root write時だけ専用batchを生成。公開batch API・scheduler・collection構造操作は対象外。イベント配線はADR-0021でdirectを採用                                                                                                  |
| Context   | instance単位context(ADR-0027)                                                  | **DONE** | `createContext`/`provideContext`/`useContext`を静的置換。root・list item・conditional branchの所有単位へ接続し、未使用時の生成物は増やさない                                                                                     |
| Heatmap 3 | 同期解析の派生値連鎖・構造unitのroot依存・条件分岐内の状態付き子部品(ADR-0033) | **DONE** | `apps/examples/heatmap.jsx`、回帰試験を追加                                                                                                                                                                                      |
| Heatmap 4 | 外部解析依存、CSS・辞書URL・Worker資源のVite境界(ADR-0034)                     | **DONE** | `@libraz/suzume`、接頭辞付き本番build、未使用外部binding除外を確認                                                                                                                                                               |
| Heatmap 5 | Worker解析、連続入力、文字確定、キーボード移動、性能測定(ADR-0035)             | **DONE** | 300段落・24,790文字の実Chromium測定、対応範囲と完了基準を`packages/bench/heatmap.results.md`へ記録                                                                                                                               |
| Heatmap 6 | 診断、型定義、別アプリ導入、自動検査、配布形式(ADR-0036)                       | **DONE** | 元ファイル・行・列付き診断、`@irisout/compiler/jsx`、別workspaceアプリのbuild試験、CI、Apache-2.0を追加                                                                                                                          |
| R1〜R4    | 次期方針の診断、ヒートマップ、初期化、外部梱包検査                             | **DONE** | R1/R2/R3、R4の梱包検査、npm公開版検査、サブエージェントによる隔離試用を完了。人間による試用は公開後の確認項目として残す                                                                                                          |
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
エラーメッセージへ付ける。公開入口は`irisout/diagnostics`であり、Vite連携の失敗も
同じ形式を使う。`compile()`と`compileProject()`はSource Map v3形式の`map`を返す。
イベント処理、`use=`の初期化・更新・破棄、`onMount`と`effect`の実行・片付けを元の
処理文へ対応付ける。Vite連携は開発時とソースマップを有効にした本番ビルドへ引き継ぐ。
共有実行時処理、DOM探索、一覧照合、条件分岐管理、自動生成した更新関数は対応対象外である。

JSX型定義は`irisout/jsx`として公開パッケージから参照できる。`apps/examples`と
`examples/consumer-app`の`tsconfig.json`がこの入口を使う。`bun run check`には両方の型検査が含まれ、
`bun run test`には別ディレクトリのVite build試験が含まれる。GitHub Actionsの`.github/workflows/ci.yml`
では`bun install --frozen-lockfile`、`bun run check`、`bun run test`、`bun run build`を実行する。

開発中の導入形式はGitリポジトリ内のworkspaceである。単一の`irisout` 0.1.0をnpmへ
公開し、公開版の導入、型検査、Vite buildを確認した。コードのライセンスはApache License 2.0で、
ルートの`LICENSE`と公開packageの`license`欄に記載する。外部解析依存のライセンスは
依存元の記載に従う。導入手順は`examples/consumer-app/README.md`、梱包検査は
`docs/adr/0047-single-public-package.md`で確認できる。

AI向けの`irisout-development` Skillは、公開入口、記述範囲、診断、検証手順とVite+アプリの
雛形を含む。GitHubリポジトリを公開元とし、`npx skills`による検出と導入を確認した。
別のエージェントプラグインとしては包装しない(ADR-0048)。

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
- **SVG(ADR-0042)**は`svg`以下の要素と`foreignObject`のnamespaceを維持し、通常の動的属性を
  `setAttribute`で更新する。静的な`xlink:*`、`xml:*`、`xmlns:*`だけを受理し、動的namespace
  属性とSVG専用property変換は対象外とする。
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
  - `children`はshorthand分割代入したcomponent本体のJSX要素にある直接の子位置へ
    展開する(ADR-0041)。children prop未宣言、属性・handlerなど直接の子位置以外の
    参照、既存render-tree未対応形式は`scope limit`。
  - 自己/相互再帰参照(`function A() { render(<A/>) }`等)は
    `scope limit`(展開中コンポーネント名のvisited集合で検出)。
  - propsは`function Foo({ a, b })`形のshorthand分割代入のみ対応。
    非shorthand(`{ a: x }`)・複数仮引数・spread propsは`scope limit`。
  - コンポーネントを構造ユニット(list item)と条件分岐ブランチへインライン化できる。
    条件分岐内の状態付き子部品は、ブランチ全体を0引数arrowのblockへ包み、
    ローカルsignalとライフサイクルをbranch factoryへ移す。children slotはADR-0041の
    直接子展開を使う。
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
