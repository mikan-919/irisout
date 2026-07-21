## Context

`src/compiler.ts`の`compile()`は現状、単一コンポーネントの直接走査
(`findRootComponent` → `compileComponent` → `renderElement`)しか知らない。
`renderElement`(`src/compiler/render.ts:444-448`)は大文字始まりのJSXタグを
無条件に`scope limit`で拒否する。

ADR-0014は「同一ファイル内の複数コンポーネント合成はコンパイル時ASTインラ
イン化で実装する」ことを決定済み(未実装)。本designはその実装アーキテク
チャを、既存コード(`src/compiler.ts` / `src/compiler/render.ts` /
`src/compiler/state.ts` / `src/codegen.ts` / `src/compiler/decl-graph.ts`)
の実際の構造に照らして具体化する。ADR-0014の決定1〜7自体は再検討しない。

具体的な検証対象(`examples/todomvc.jsx`の`TodoApp`→`TodoItem`分割)を
実際に読むと、現状スコープ外の制約に直接ぶつかることが分かった:
`STATUS.md`は「リストアイテム本体・条件分岐ブランチ本体の中のテキストで
追跡対象のsignal/derivedを直接参照すること」を明示的に`scope limit`として
おり(UNRESOLVED-04とセットで将来緩める、との注記付き)、現行の
`editingId() === todo.id ? ... : ...`(ルートsignal参照)はこの制限に
かかる。ADR-0014の「ローカルsignal」(`CONTEXT.md`)はこの制限をルート
signalについては維持したまま、**インライン化により生まれた同一ユニット
内のローカルsignalに限って**解除する必要がある ― ADR-0014本文はこの帰結を
明記していないが、検証対象を実際に動かすには必須の下位決定なので、本
designで明文化する。

## Goals / Non-Goals

**Goals:**
- 同一ファイル内`<Component/>`参照のコンパイル時ASTインライン化
  (ADR-0014決定1〜5、7)。
- コンポーネントの変数ゾーンsignal/derivedが構造ユニット(リスト/条件分岐)
  へインライン化された場合の「ローカルsignal」対応(ADR-0014決定6)。
  これに伴い、**同一ユニット内**のローカルsignalへのローカルマーカー依存を
  scope limitの対象から除外する(ルートsignalへの依存は引き続き対象)。
- `examples/todomvc.jsx`の`TodoApp`→`TodoItem`分割を実際にコンパイルが
  通る形で検証する。

**Non-Goals:**
- 複数ファイル・import解決(ROADMAP §4に残す、ADR-0014決定1で対象外済み)。
- children/slot、再帰・循環参照(ADR-0014決定7で明示的にscope limit)。
- 2階層以上ネストした構造ユニットへの対応拡大(M5.5の既存制約を維持、
  インライン化はその制約の内側で完結させる)。
- ローカルsignalが**ネストした別ユニット**や**祖先ユニット**のローカル
  signalに依存するケース(実需・検証対象に無いので今回は素通しせず
  scope limitで拒否する)。

**実装前の実地検証で判明した追加のNon-Goal**: `examples/todomvc.jsx`を
実際に現行コンパイラへ通したところ、ADR-0014とは無関係な既存scope limit
(`{visibleTodos().length > 0 && (<ul>...)}`が`<div class='todoapp'>`の
sole childでない ― M5のsole-child制約、`render.ts:567`)に**現状でも
ぶつかることを確認した**(このフィクスチャは元々「まだコンパイルできない
仕様フィクスチャ」と明記されている)。さらに、このフィクスチャの構造
(外側の条件分岐 > リスト > リストアイテム内の条件分岐)はM5.5の
「1階層ネストのみ」の制約に対しては**3構造ユニットの入れ子**になり、
仮にsole-child制約を解消しても`unitDepth>=2`のscope limitに別途ぶつかる。
これらは本changeのスコープ外(ROADMAP UNRESOLVED-06/07・§5の別課題)。
**本changeは`examples/todomvc.jsx`全体を実際にコンパイルが通る状態には
しない** ― `TodoApp`→`TodoItem`分割とローカルsignal自体の検証は、これらの
無関係な制約を踏まないテスト専用フィクスチャで行う(task 6.4はこの前提に
合わせて更新する)。あわせて、UNRESOLVED-07(編集モードのspan/input
入れ替え)は「ネストした構造ユニットが祖先ユニットのローカルsignalに
依存する」ケースに該当し、本changeでも引き続きscope limitのまま
(下記D6参照)。`TodoItem`の`editing`ローカルsignalは、07のDOM入れ替え
ではなく**同一ユニット内の動的class属性バインディング**
(`class={editing() ? 'editing' : ''}`、実物のTodoMVCと同じCSSベースの
編集インジケータ)で検証する ― これは「同一ユニット内での直接依存」
(D6で許可する範囲)に収まる。

## Decisions

### D1. インライン化は独立した前処理パス、`findRootComponent`の前に実行

`compile()`(`src/compiler.ts:137`)内で、`parse`直後・`assertTopLevelShape`
の後に新パス`inlineComponents(ast)`を追加する。このパスは:
1. Program直下の`FunctionDeclaration`をすべて集める(`findRootComponent`の
   `componentsByName`収集ロジックと同型 ― 共有ヘルパーへ切り出す)。
2. 各コンポーネント本体を走査し、`JSXOpeningElement`で大文字始まり・
   既知コンポーネント名のタグを見つけるたびに、そのJSXElement自体を
   呼び出し先コンポーネントの`render()`引数JSXの**クローン**で
   `path.replaceWith`する。展開前にpropsの識別子置換(D3)を適用する。
3. 呼び出し先の変数ゾーン宣言(signal/derived)は、呼び出し箇所が
   ルートスコープか構造ユニット内かに応じて異なる場所へ再配置する
   (D5)。動きゾーンのfunction宣言は呼び出し元の動きゾーンへ統合する
   (D6)。
4. 展開中のコンポーネント名集合(visited)を保持し、再訪問時は
   `compile: recursive component reference "X" is not supported yet
   (scope limit)`で拒否(ADR-0014決定7)。
5. パス終了後、`findRootComponent`とその後続の`compileComponent`/
   `renderElement`は無変更のまま動く ― 展開済みASTには元から単一
   コンポーネントしか書かれていなかったかのような形が残る。

この前処理パスの入出力は「元ASTを書き換え済みASTにする」であり、
`compileComponent`側の走査ロジックはコンポーネントという概念を一切知らない
ままでよい(ADR-0014決定3の理由をそのまま踏襲)。

### D2. 呼び出し先コンポーネントの特定と分類

呼び出し先は`findRootComponent`と同じ`componentsByName`表から名前解決
する。**ルート候補と非ルート候補の区別はこのパスでは不要**(ルート判定は
インライン化後に`findRootComponent`が改めて行う ― `TodoItem`はどのみち
他から参照されるので自動的にルート候補から外れる、ADR-0014コンテキスト
節の指摘どおり)。

`render.ts:444-448`の一律拒否は、インライン化パス通過後に**残っている**
大文字始まりタグ(= 名前解決できなかった参照、または多階層ネスト等で
展開しきれなかったもの)にのみ適用されるよう文言を維持する ― 通常の
インライン化成功パスでは、このコードに到達する時点で対象タグは既に
JSXとして展開済みのため到達しない。

### D3. props置換はコンパイル時identifier substitution(Babel scope解決を利用)

呼び出し先`function TodoItem({ todo, onToggle }) {...}`の仮引数
`ObjectPattern`から、プロパティ名→ローカル変数名の対応表を作る
(shorthand以外の`{ todo: t }`形は今回のスコープでは考慮しない ―
検証対象フィクスチャに現れないため)。呼び出し箇所`<TodoItem todo={t}
onToggle={fn} />`の各JSXAttributeから、対応するプロパティ名の実引数式を
取り出す。

クローンした本体を`path.scope`で再走査し、ローカル変数名にバインドされた
`Identifier`参照を対応する実引数式の**クローン**で置き換える
(`t.cloneNode(argExprNode, true)`を参照ごとに使う ― 同じ式ノードの
使い回しはBabel上不正)。バインディング解決には呼び出し先関数の
`NodePath.scope.getBinding(name)`を使い、無関係な同名変数(シャドーイング)
を誤って置換しないことを保証する。

### D4. 名前衝突の検出とリネーム(ADR-0014決定5)

`assignOutputName`(`src/compiler/state.ts:204`)は既に`usedOutputNames`
グローバル集合を見て衝突時に`$1`,`$2`...を付ける既存のハイジーン機構を
持つ。ADR-0014は衝突時に読みやすいコンポーネント名接頭辞
(`TodoItem_count`)を求めているため、これを**`assignOutputName`の前段**
として実装する: インライン化パスが各signal/derived宣言のnaturalNameを
決める際、その時点で`ctx.usedOutputNames`に既に同名が存在する場合のみ
`${componentName}_${naturalName}`を候補にしてから`assignOutputName`へ渡す
(存在しなければ素のnaturalNameのまま渡す ― 大多数の非衝突ケースで
prefixノイズを持ち込まない、決定5の理由と一致)。

動きゾーンのfunction宣言名(ハンドラ識別子参照解決表 `handlerFns`/
`ctx.movementFns`のキー)も同じ規則で衝突検出・リネームする ―
こちらは`usedOutputNames`とは別の名前空間(関数名 vs signal出力変数名)
なので、`ctx.usedOutputNames`とは別に「呼び出し元の動きゾーンに既に
存在する関数名の集合」を都度チェックする。

### D5. 変数ゾーン宣言の再配置:ルートスコープ vs ローカルsignal

呼び出し箇所がコンポーネントのトップレベル(構造ユニットの外)にある場合、
展開されたsignal/derived宣言は通常のルート変数ゾーン宣言として
`processDeclarationStatement`にそのまま処理させる(呼び出し元コンポー
ネントの変数ゾーンへ、呼び出し箇所の直前に挿入したのと同じ効果)。

呼び出し箇所が構造ユニット(`.map()`アイテム/条件分岐ブランチ)の内側に
ある場合、展開されたsignal/derived宣言は**ローカルsignal**になる
(ADR-0014決定6、`CONTEXT.md`)。今回の検証対象は後者(`TodoItem`が
`TodoApp`の`.map()`アイテムへインライン化される)なので、こちらを実装の
主眼にする。実装:
- `renderListUnit`/`renderStructuralUnitBody`
  (`src/compiler/render.ts:680,736`)が前提とする「アイテムのarrow本体は
  bare JSX」を拡張し、ブロック本体
  (`(item) => { const editing = signal(false); return <li>...</li> }`)
  ―インライン化パスが生成する形 ― も受理する。ブロック内で許容する文は
  signal/derived宣言と最終`return`のみ(scope limitで他を拒否、
  `assertTopLevelShape`と同じ発想)。
- 検出したローカルsignal宣言は`StructuralUnitBody`
  (`src/compiler/state.ts:63`)に新フィールド`localDecls: LocalDeclOutput[]`
  として持たせる(DeclId・出力名・kind・レンダー済み初期化式)。
  `ctx`にはこのDeclId集合を「ローカル宣言である」と引ける
  `localDeclIds: Set<DeclId>`を追加する(D6の判定・拒否の両方で使う)。
- **`generateFactory`は新しい関数を作らない**。既存の`generateFactory`
  (`src/codegen.ts:173`)は`itemParam`がある(=リストアイテム)場合、
  常に`function update(...) {...}`をfactory本体の先頭付近に生成し
  (テキスト/属性/ネストしたユニットの再描画をまとめて行う、既存M5の
  仕組み)、生成直後に1回呼ぶ(初期HTMLがユニット部分を空で焼くため)。
  ローカルsignalの書き込みで必要な「このアイテムの表示だけ更新する」は
  **この既存の`update()`をそのまま再利用**すれば足りる ― 新しい
  `update_<name>()`をfactory内に追加で生成する必要はない(ADR-0014決定6の
  文言は「factory内のローカル関数」だが、既存の`update()`がまさにそれに
  当たる。屋上屋を避ける)。
- factory本体の先頭(`__node__`/`__el__`確保の直後)で
  `let <name> = <init>;`を`localDecls`ごとに宣言する。
- ローカルsignalへ書き込むローカルハンドラ(`body.localHandlers`のうち
  `writeDeclIds`が`ctx.localDeclIds`と交差するもの)は、他の
  `updateNames`呼び出しに加えて**bare `update()`呼び出し**を追記する
  (D6で述べる「同一ユニット直下限定」であれば、このハンドラの
  `addEventListener`行と`function update(...)`宣言は同じfactory関数の
  同じネスト深さにあり、関数宣言の巻き上げにより参照は曖昧にならない)。
- 依存グラフ(`resolveToSignals`、`src/compiler/decl-graph.ts`)はDeclIdが
  ルート/ローカルを区別しないため、ローカルsignalのDeclIdも同じ
  `ctx.declKind`/`ctx.derivedDeps`に載せてよい(recompute式の解決に使う
  ため)。ただし**`ctx.markerDeps`/グローバルの`signalToMarkers`には
  絶対に載せない**(下記D6のガード参照 ― 載せると生成コードがモジュール
  スコープに存在しない変数を参照する壊れた出力になる、実装前調査で
  確認した実際の失敗モード)。

### D6. ユニット内マーカーのローカルsignal依存を許可する範囲(同一ボディ直下のみ)

`renderStructuralUnitBody`(`render.ts:680`)は現状、**自分のボディに
直接splice された**テキストマーカー・属性バインディングが何らかの
tracked signalに依存していたら無条件に`scope limit`で拒否する
(`STATUS.md`既知の制約)。ネストした構造ユニット(list/conditional)の
依存は`nestedDeps`として外側へバブルアップする既存のM5.5機構が別途ある
(そちらは拒否ではなく合流)。

実装前調査で判明した重要な制約: **ネストした構造ユニット(例:
リストアイテム内の条件分岐)がそのアイテム自身のローカルsignalに依存する
ケース(UNRESOLVED-07の編集モードspan/input入れ替えが該当)は、既存の
`nestedDeps`バブリングにそのまま乗せると、ローカルsignalのDeclIdが
グローバルな`ctx.markerDeps`/`signalToMarkers`まで漏れ、存在しない
モジュールスコープ変数を参照する壊れたコードを生成する**(トレースして
確認済み)。これは本changeでは資さない(Non-Goals参照、UNRESOLVED-07は
引き続き未解決のまま)。よって:

- **同一ボディへ直接spliceされたテキストマーカー・属性バインディング**が
  依存先DeclIdとして`ctx.localDeclIds`に含まれるものだけを持つ場合 →
  許可する(scope limitを投げない)。生成コードは既存の`update()`が
  そのテキスト/属性を再描画する(既存のrefreshTexts/refreshAttrsの仕組み
  がそのまま使える ― コード変更は「スロー条件の緩和」のみで、
  codegen側の再描画ロジック自体は無変更)。
- **ネストした構造ユニット(list/conditional)の`nestedDeps`に
  `ctx.localDeclIds`のメンバーが含まれる場合** → 従来の「合流」ではなく
  明示的に`scope limit`で拒否する:
  `compile: a nested structural unit depending on a local signal is not
  supported yet (scope limit)`。これにより UNRESOLVED-07 相当の入れ子は
  安全に拒否され、グローバルへの漏れを防ぐ。
- それ以外(依存先がルートsignal、または`ctx.localDeclIds`に無いdeclId) →
  従来どおりの挙動(テキスト/属性は無条件scope limit、ネストユニットは
  合流)を変更しない。

### D7. 動きゾーン(function宣言)の統合

インライン化された呼び出し先の動きゾーンfunction宣言
(`TodoItem`内の`toggleTodo`等 ― 実際には`todomvc.jsx`のTodoItem候補に
渡ってくるハンドラはpropsとして受け取るため、TodoItem自身の動きゾーンは
無い可能性が高いが、一般形として対応する)は、呼び出し元コンポーネントの
`handlerFns`(`compileComponent`が構築する動きゾーン関数表、
`render.ts:944`)へ統合する。名前衝突はD4と同じ規則でリネームする。
`cross-function-handler-writes`(ADR-0013)の追跡は`ctx.movementFns`を
参照する既存ロジックがそのまま使える(統合後の表を見るだけでよい)。

### D8. children/slot・再帰参照の拒否(ADR-0014決定7)

- children: `<Component>...</Component>`(JSXElementの`children`が
  空でない)を検出したら
  `compile: component children are not supported yet (scope limit)`。
- 再帰: D1のvisited集合で検出し
  `compile: recursive component reference "X" is not supported yet
  (scope limit)`。

## Risks / Trade-offs

- **[Risk] ローカルsignal機構(D5/D6)は構造ユニットのcodegenに新しい
  分岐を持ち込み、既存のM5/M5.5 factory生成コードとの相互作用が複雑**
  → 緩和: スコープを「同一ユニット内のみ」に厳密に限定(祖先/別ユニット
  依存は今回もscope limitのまま)。ネスト2階層以上は既存制約のまま拒否
  されるため、ローカルsignal対応も自動的にその範囲に収まる。
- **[Risk] props識別子置換(D3)がBabel scopeのシャドーイング判定を誤ると
  無関係な変数を書き換える** → 緩和: `NodePath.scope.getBinding`による
  厳密なbinding同一性チェック(ADR-0013の呼び出し追跡で使った手法と
  同じ検証パターン)。テストで内側で同名ローカル変数を宣言するケースを
  カバーする。
- **[Risk] 名前衝突リネーム(D4)がすべてのケースを網羅できていないと
  黙って壊れたコードを出力する** → 緩和: リネーム漏れは「衝突」なので
  `usedOutputNames`/動きゾーン関数名の集合チェックに必ず引っかかる
  設計にする(検出漏れではなく、検出後の対応漏れのリスクに限定される)。
- **[Trade-off] 今回はローカルsignalの依存先を同一ユニットに限定する
  ため、`TodoItem`がさらに孫コンポーネントを持ち、そのローカルsignalに
  親側からアクセスするような一般形はscope limitのまま** → 実需が
  出るまで対応しない(ADR-0014の主動機である構造ユニットの名前付き
  切り出しには不要)。

## Migration Plan

新規機能追加のみで既存の出力・APIに破壊的変更はない。既存のscope limit
文言のうち、D6で緩和する条件分岐(同一ユニット内ローカルsignal依存を
許可)以外は変更しない。ロールバックは本changeのコミットをrevertするのみ
で足りる(既存フィクスチャ・テストへの影響はテストタスクで確認)。

## Open Questions

なし(ADR-0014で決定済みの範囲に閉じており、本designで具体化した下位
決定はいずれもNon-Goalsで明示した範囲外ケースをscope limitに倒すことで
決着している)。
