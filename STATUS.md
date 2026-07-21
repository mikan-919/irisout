# irisout 実装ステータス

実装の「今」の状態(現在地・マイルストーン進捗・既知の制約)をまとめたもの。
設計判断待ちの論点・次のアクションの計画は `ROADMAP.md` を参照。

## 現在地(2026-07-21・型検査基盤)

authored `.jsx` の型検査基盤を実装(change `jsx-type-checking-foundation`、
ROADMAP 次のアクション10)。`types/jsx.d.ts`でグローバル`JSX`namespace
(`Element`・`IntrinsicElements`・`IntrinsicAttributes`)と`signal`/
`derived`/`render`のグローバル関数シグネチャを宣言し、`examples/`配下
専用の`examples/tsconfig.json`(`allowJs`+`checkJs`+`jsx: "preserve"`、
`types: []`)で`examples/*.jsx`を型検査対象にした。ルートの`tsconfig.json`
は無変更 ― `allowJs`/`checkJs`をルートへ足すと
`examples/todomvc.handwritten.js`(`test/todomvc-handwritten.test.ts`が
importする比較用の手書きJS、型検査対象外)まで巻き込まれ、既存の
`@ts-expect-error`抑制が壊れるため、examples専用の別プロジェクトに
切り出した。あわせて`node_modules/@types/react`が自動包含され`JSX`
namespaceを上書きする踏み台バグを`types: []`で踏みつぶした(実装前調査
未発見の計画外の落とし穴)。ADR-0011が先送りしていた`use=`のJSX型定義
(design.md Decision 6)も同時に解消した。

属性名は意図的に緩い(共通属性`key`/`use`/`onXxx`/`children`のみ明示し、
他は`string`キーで許容 ― コンパイラ自身が host 属性名をホワイトリスト化
していないため)。`examples/tsconfig.json`は`strict: false`(authored
`.jsx`は型注釈を書けない素のJS構文なので、strictを掛けるとハンドラ引数の
ほぼ全てが implicit any でエラーになり実用にならない)。型が通ることと
実行時に`compile()`が受理することは別軸のまま ― 型はコンパイラの
scope limit判定を代替しない(例: リストアイテム内の`use=`は型上は書けるが
実行時は既存のscope limitのまま、下記制約参照)。

## 現在地(2026-07-21)

同一ファイル内の複数コンポーネント合成を実装(ADR-0014、change
`same-file-component-composition`、ROADMAP §4・UNRESOLVED-04 解消)。
`<Component/>`参照を`findRootComponent`より前の独立した前処理パス
(`src/compiler/inline-components.ts`)でコンパイル時ASTインライン化する
― `compileComponent`/`renderElement`は無変更のまま単一コンポーネント
前提で動く。propsはshorthand分割代入のみ対応するコンパイル時識別子
置換(実行時オブジェクトなし)。リストアイテムへインライン化された
コンポーネントの変数ゾーンは「ローカルsignal」(factory クロージャ専有、
module scopeに一切出ない)になり、同一ユニット直下のテキスト/属性
バインディングのみそこへの依存を許可する(下記制約参照)。名前衝突は
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
あわせて、構造ユニットを唯一の子に持つ要素のハンドラが黙って捨てられる
計画外バグを発見・修正(ユニットのマーカー id へ配線)。

2026-07-19: ハンドラ/action 本体からの動きゾーン関数呼び出しの追跡を実装
(ADR-0013、change `cross-function-handler-writes`、ROADMAP 論点0 解消)。
`onClick={() => toggle(todo.id)}` のような引数つき補助関数呼び出しで
`toggle` 本体の signal 書き込みが解析されず **update_*() が黙って落ちて
いた** M2 以来のバグを解消。callee の binding が動きゾーンの function 宣言と
同一なら本体を再帰解析(visited-set・深さ制限なし)し、`writeDeclIds` を
呼び出し元へ合流、書き換え済み関数を authored 名のままモジュールスコープへ
1回だけ emit する。あわせて新しい scope limit を2つ追加(下記制約参照)。

## マイルストーン表

| M | 内容 | 状態 | 備考 |
|---|------|------|------|
| M1 | スキャフォールド、signal/derived、テキストマーカー | **DONE** | `0155e85` |
| M2 | イベントハンドラ、書き込みトリガー更新 | **DONE** | `810bc83`→`645a820`、plan 005 |
| M3 | ブラウザビルドターゲット(hydrate/mount分割 + `scripts/build.ts`) | **DONE** | `a2905c8`、plan 001 |
| M4 | 静的host要素属性 | **DONE** | `9829f88`、change `m4-static-host-attributes` |
| M4.5 | authoring APIゾーン化(ADR-0008) | **DONE** | change `authoring-api-zones`。render()マーカー・識別子参照ハンドラ・ゾーン配置強制 |
| M5 | list/conditional factory closures、1階層のみ(ADR-0005の新実装) | **DONE** | change `m5-list-conditional-factory-closures`。ネストした構造ユニット(06/07)は据え置き |
| M5.5 | ネストした構造ユニット(条件分岐の中のリスト/リストアイテムの中の条件分岐、UNRESOLVED-06/07) | **DONE** | change `m5-5-nested-structural-units`。1階層ネストのみ、2階層以上は引き続きscope limit |
| `use=` | top-level要素へのaction接続(ADR-0011) | **DONE** | change `use-action-impl`。ユニット内`use=`・JSX型宣言は未実装のまま(下記制約参照) |
| M6 | 全マイルストーン横断のno-wrapper検証 | **DONE** | change `m6-no-wrapper-verification`。全機能同居フィクスチャで no-wrapper・import面・実DOM動作を固定(`test/no-wrapper.test.ts`)。サイズ予算係数は 4x のまま据え置き(counter が固定費支配の最悪ケースのため。締め直しは minify 着手時に再検討 ― ROADMAP「minify」) |
| 合成 | 同一ファイル内の複数コンポーネント合成(ADR-0014) | **DONE** | change `same-file-component-composition`。コンパイル時ASTインライン化、root scope + list itemのみ、children/slot・再帰・複数ファイルは未対応のまま(下記制約参照) |

## 既知の制約(現時点のcodegenの限界)

- **ルートコンポーネントは1つだけ**: `compile()`は「他から一度も参照
  されないトップレベル関数」がちょうど1つであることを要求し、そうで
  なければcompile error(`src/compiler.ts`のscope limit)。
- **トップレベルは関数宣言のみ**(2026-07-18、change `scope-limit-coverage`):
  Program 直下は関数宣言(`export` 付き含む)以外(import・トップレベル
  `const`・副作用式等)を `scope limit` で一律拒否する。現状の実装では
  出力に反映されず黙って捨てられるため、拒否が正直な挙動。分割代入宣言子
  (`const [a] = signal(0)` 等)も同様に拒否。ビルド時実行の例外は
  `compile: build-time execution failed:`(`cause` 付き)に包まれる。
- **複数インスタンス不可**、ただし2つの別物が混ざっているので分けて書く:
  - (a) *リスト内でのN件ベンチマーク*(例: 1コンポーネント内で1万件の
    リストアイテムを持つ場合の性能・状態保持)は、ADR-0005のfactory
    closureで解決済み(M5)。
  - (b) *トップレベルコンポーネント自体の複数mount*(同じコンポーネントを
    2つ以上のコンテナへ`mountComponent`/`hydrateComponent`する)は別問題。
    `__markers__`・`update_*`がモジュール直下スコープで生成される設計
    (`src/codegen.ts:68`の`let __markers__;`)のため、M5(list item
    factory closure)が入っても解消しない。トップレベルのmount/hydrate
    自体をfactory化する変更が別途必要になるが、**未計画・未着手**で、
    ロードマップ上のどのマイルストーンにも属さない。実需が出た時点で
    設計判断すること。
    (補足) Reactの`ref`が条件分岐で`null`になるのとは性質が違う ―
    Reactのnullは「要素が今存在するか」を表す正常な状態遷移だが、
    `__markers__`のnullは「同じ変数を複数のライフサイクルインスタンスで
    共有している」ことそのものが原因で、mount/hydrateのたびに正しく
    出し入れされる設計にはなっていない。根本的な違和感は「`__markers__`が
    暗黙に(呼び出し順序の慣習だけを頼りに)書き込まれる」こと自体にある。
    ADR-0005のfactory closureパターンをトップレベルにも広げれば構造的に
    解消できるが、それはAPIの大きな変更を伴う。実需が出るまでは着手しない
    (2026-07-05 grillingで確認済み)。
- 静的host属性はM4、動的(式コンテナ)host属性値はADR-0012(change
  `dynamic-attribute-bindings`)で実装済み。attribute/property の使い分けは
  固定表(`checked` = booleanプロパティ、`value` = 文字列プロパティ、他は
  `setAttribute`)。ユニット内の属性式が**ルート**signalを参照するのは
  テキストと同じく `scope limit`。**同一ユニット直下で宣言されたローカル
  signal**(下記「同一ファイル内コンポーネント合成」参照)への依存のみ
  ADR-0014(change `same-file-component-composition`)で許可した
  (UNRESOLVED-04解消)。
- **リスト(`.map()`)・条件分岐(三項/`&&`)はM5+M5.5で実装済み**
  (change `m5-list-conditional-factory-closures` /
  `m5-5-nested-structural-units`)。ネストは1階層まで(リストアイテム内の
  条件分岐/条件分岐ブランチ内のリスト)。以下は明示的な scope limitで
  拒否する:
  - 2階層以上のネスト(ネストした構造ユニットの内側に、さらに別の構造
    ユニットがある場合)。
  - リスト/条件分岐の式コンテナが親要素の唯一の子でない場合(兄弟要素との
    混在)。コメントアンカー機構を持たないための単純化。ネストした構造
    ユニットにも同様に適用される。
  - リストアイテム本体・条件分岐ブランチ本体の中のテキストで**ルート**
    signal/derivedを直接参照すること(item要素のフィールド参照は対象外 ―
    trackされないので素通りする)。**同一ユニット直下のローカルsignal**
    への依存はADR-0014で許可(上記参照)。ネストした構造ユニットの条件式・
    配列式はルートsignal依存の制限対象外(依存は外側マーカーへバブル
    アップし、正しく更新が届く)。ただしネストした構造ユニットが
    **祖先ユニットのローカルsignal**に依存することは、ローカルsignalの
    declIdがグローバルなsignalToMarkersへ漏れて壊れたコードを生成する
    ため明示的に拒否する(ADR-0014、UNRESOLVED-07の編集モードspan/input
    入れ替えが該当、引き続き未解決)。ハンドラ内でのsignal読み書きも
    ルートsignal制限の対象外(通常のハンドラと同じ仕組みで動く)。
  - `.map()`のコールバックのブロック本体(`=> { ... }`)は、
    「signal()/derived()宣言 + 最終return」の形(ADR-0014のローカル
    signal宣言)のみ受理する。それ以外の文を含むブロック本体は引き続き
    `scope limit`。
  - リストアイテムに `key` 属性がない場合、または `key` が追跡対象の
    signalを参照する場合。
  - `.map()` のコールバックがブロック本体(`=> { ... }`)の場合(concise
    bodyのみ対応)。
- **フィルタ全件除外時の状態破棄**(M5.5、design.md Decision 2): 条件分岐
  ブランチにネストしたリストは、外側の条件分岐が選択を切り替えてリスト
  全体を非マウントにした瞬間、keyed Map・ローカル状態が(フィルタで
  非可視だっただけのアイテムも含めて)全件破棄される。「フィルタ除外時の
  状態保持」保証は、そのリスト自身がDOM上にマウントされ続けている間に
  限られる(spec「配列脱落とフィルタ除外の区別」の境界条件)。
- ハンドラ(inline arrow / 識別子参照の function宣言 どちらも)のブロック
  本体は4文種(式文 / `const`・`let` / `if` / 裸の `return`)に限る
  (ADR-0009)。第1仮引数(イベントオブジェクト)は authored 名のまま受け渡す
  が、分割代入・第2引数以降は `scope limit` で拒否する。ループ・
  `try`/`switch`・関数/クラス宣言・`var`・値を返す `return`、および
  ソース順で追跡書き込みより後ろの `return` も同様に `scope limit` で拒否
  する(D3: 末尾 `update_*()` の取りこぼしを防ぐため)。
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
- **`use={fn}`アクション(ADR-0011、change `use-action-impl`)はtop-level
  要素のみ実装済み**。以下は明示的な scope limit・別changeへの先送り:
  - リストアイテム/条件分岐ブランチ内の`use=`は返り値クロージャの動的
    レジストリが未実装のため`scope limit`で拒否(design.md Decision 3)。
    実需(アイテム内canvas等)が出た時点で別change。
  - JSX型定義(`JSX.IntrinsicElements`の`use`宣言)は未実装(design.md
    Decision 6)。authored `.jsx`の型検査基盤自体が未整備なため、それを
    一括整備する別changeで扱う。
  - reactive params・複数action・cleanupはADR-0011の未決定事項のまま
    (実需が出るまで作らない)。
  - action本体のconcise arrow(単一式)にネストしたリスナー等がある場合、
    その内部の書き込みに対する`update_*`挿入位置は本体全体の実行時点に
    まとまる(リスナー発火時ではない)。ブロック本体は正しく分離される
    (`src/compiler/analyze.ts`の`analyzeActionExprScope`コメント参照)。
- **同一ファイル内コンポーネント合成(ADR-0014、change
  `same-file-component-composition`)は同一ファイル・root scopeと
  list itemへのインライン化のみ実装済み**。以下は明示的な scope limit・
  別changeへの先送り:
  - `<Component>children</Component>`(children/slot)は`scope limit`。
    実需が出るまで対応しない(ADR-0014決定7)。
  - 自己/相互再帰参照(`function A() { render(<A/>) }`等)は
    `scope limit`(展開中コンポーネント名のvisited集合で検出)。
  - propsは`function Foo({ a, b })`形のshorthand分割代入のみ対応。
    非shorthand(`{ a: x }`)・複数仮引数・spread propsは`scope limit`。
  - コンポーネントを構造ユニット(list item)へインライン化できるのは
    `.map()`アイテムの位置のみ。条件分岐ブランチへのインライン化は、
    対象コンポーネントが変数ゾーン宣言(ローカルsignalになる宣言)を
    一切持たない場合のみ動作する ― 条件分岐ブランチは三項/`&&`の式
    位置でブロック文を置けないため、ローカルsignal付きコンポーネントの
    ブランチへのインライン化は現状未対応(実装は同一ユニットのみ)。
  - **propsの参照は、置換対象がJSX属性値/式コンテナの中身全体(または
    ハンドラarrowのconcise body)である場合、または実引数がprops名と
    同名のbare identifier(`<TodoItem todo={todo} />`)である場合のみ
    安全**。それ以外(例: `{enabled ? 'on' : 'off'}`のように三項演算子の
    条件部分で参照する、または`<Foo item={t} />`のようにprops名と異なる
    名前の実引数をメンバー式内で参照する)は、置換後の内容がソース位置
    ベースの書き換え検出(`analyze.ts`のidentifier-visitベースのedit機構)
    に乗らず、呼び出し先の古いソーステキストが出力に残ってしまう
    (実装前調査で確認)。`src/compiler/inline-components.ts`の
    `assertSafeToSubstitute`が安全でない組み合わせを検出し
    `compile: ... is referenced inside a larger expression ... (scope
    limit)`で明示的に拒否する(黙って壊れたコードを出さない)。値なしの
    boolean-shorthand属性(`<Foo enabled/>`)も、対応する実引数テキストが
    ソース上に存在しないため同様に拒否する ― `enabled={true}`のように
    明示的な値を渡せば(トップレベル位置であれば)使える。
  - 名前衝突: ルートスコープへ統合されるsignal/derived宣言名・動きゾーン
    関数名は、呼び出し元の既存識別子と衝突する場合のみ、衝突した側を
    コンポーネント名で接頭辞化してリネームする(例: `TodoItem_count`,
    `TodoItem_inc`)。衝突しない場合はauthored名のまま出力する。
