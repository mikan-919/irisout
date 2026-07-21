## 1. コンポーネント解決の共有ヘルパー

- [ ] 1.1 `src/compiler.ts`の`findRootComponent`が持つ
      「Program直下のFunctionDeclarationを名前で集める」ロジックを
      共有ヘルパーへ切り出す(インライン化パスと`findRootComponent`の
      両方から使う)。
- [ ] 1.2 ユニットテスト: 複数コンポーネントが宣言されたソースから
      正しい名前→NodePath表が得られること。

## 2. インライン化前処理パスの骨格

- [ ] 2.1 新規モジュール(例: `src/compiler/inline-components.ts`)に
      `inlineComponents(ast)`を実装: `assertTopLevelShape`後・
      `findRootComponent`前に呼ぶ。トップレベルの各コンポーネント本体を
      走査し、大文字始まりJSXタグで既知コンポーネント名に一致するものを
      列挙する(まだ置換はしない)。
- [ ] 2.2 展開中のコンポーネント名を保持するvisited集合を用意し、
      再訪問時に`compile: recursive component reference "X" is not
      supported yet (scope limit)`を投げる(自己再帰・相互再帰の両方を
      テストでカバー)。
- [ ] 2.3 コンポーネント参照JSX要素が子要素を持つ場合、
      `compile: component children are not supported yet (scope limit)`
      を投げる。
- [ ] 2.4 `src/compiler.ts`の`compile()`から`inlineComponents(ast)`を
      `assertTopLevelShape`の直後・`findRootComponent`の前に呼び出す。

## 3. props置換

- [ ] 3.1 呼び出し先関数の`ObjectPattern`仮引数からプロパティ名→
      パラメータ名の対応表を作る(shorthand形のみ対応、それ以外の分割
      代入形は`scope limit`)。
- [ ] 3.2 呼び出し箇所JSXの各`JSXAttribute`から対応する実引数式を取り出し、
      クローンした呼び出し先本体を`path.scope.getBinding`で解決した
      パラメータ参照ごとに実引数式のクローンで置換する。
- [ ] 3.3 テスト: プロパティ参照の置換、シャドーイングされた同名ローカル
      変数が誤って置換されないこと。

## 4. ルートスコープでの単純なインライン化(props置換のみ、ローカルsignalなし)

- [ ] 4.1 呼び出し箇所がコンポーネント本体のトップレベル(構造ユニット外)
      にある場合の展開: 呼び出し先の`render()`引数JSX(props置換済み)を
      呼び出し箇所へ`replaceWith`する。
- [ ] 4.2 呼び出し先の変数ゾーンsignal/derived宣言を、呼び出し元の変数
      ゾーンへ(呼び出し箇所を含んでいた文の直前に)挿入する。
- [ ] 4.3 呼び出し先の動きゾーンfunction宣言を、呼び出し元の動きゾーンへ
      統合する。
- [ ] 4.4 名前衝突検出とコンポーネント名リネーム(design D4): signal出力
      変数名・動きゾーン関数名それぞれについて、統合前に呼び出し元の
      既存識別子と衝突する場合のみ`${componentName}_${name}`へリネームし、
      本体内の参照も追随させる。衝突しない場合は素の名前のまま。
- [ ] 4.5 テスト: 子要素を持たないシンプルなコンポーネント(例:
      `Footer({ count })`)がトップレベルで参照され、`render.ts:444-448`の
      scope limitに引っかからずコンパイルが通り、生成コードが期待どおり
      動くこと。
- [ ] 4.6 テスト: 2つの異なるコンポーネントが同名のsignalを宣言し、
      両方がトップレベルへインライン化されるケースで、リネームが発生し
      両方の変数が独立して動くこと。

## 5. 構造ユニットへのローカルsignal付きインライン化

- [ ] 5.1 `src/compiler/state.ts`の`StructuralUnitBody`に、ユニット
      ローカルのsignal/derived宣言を表す新フィールド(例:
      `localDecls`)を追加する。
- [ ] 5.2 `renderListUnit`/`renderStructuralUnitBody`
      (`src/compiler/render.ts`)が、`.map()`アイテムのarrow本体が
      bare JSXではなくブロック本体
      (`(item) => { const x = signal(...); return <li>...</li>; }`)の
      場合も受理するよう拡張する。ブロック内で許容する文はsignal/derived
      宣言と最終`return`のみとし、他の文は`scope limit`で拒否する
      (条件分岐ブランチ側も同様に対応する)。
- [ ] 5.3 インライン化パス(セクション2/3)が、構造ユニット内の呼び出し
      箇所を展開する際、呼び出し先の変数ゾーン宣言をルート変数ゾーンでは
      なく、上記のブロック形式のローカル宣言として呼び出し箇所の直前に
      配置するよう分岐を追加する(呼び出し箇所がトップレベルか構造ユニット
      内かの判定はJSX要素のNodePathの祖先を辿って判定する)。
- [ ] 5.4 `ctx`に「このDeclIdはローカルsignal宣言である」ことを引ける
      `localDeclIds: Set<DeclId>`を追加する。
- [ ] 5.5 `renderStructuralUnitBody`のローカルマーカー依存チェックを
      変更する: (a) **このボディに直接spliceされた**テキスト/属性
      バインディングの依存先が全て`ctx.localDeclIds`のメンバーである
      場合のみscope limitを投げず許可する。ルートsignalへの依存は
      従来どおり無条件拒否のまま。(b) ネストした構造ユニットの
      `nestedDeps`に`ctx.localDeclIds`のメンバーが含まれる場合、
      既存の合流(bubbling)には乗せず
      `compile: a nested structural unit depending on a local signal
      is not supported yet (scope limit)`で明示的に拒否する(ローカル
      signalのDeclIdがグローバルな`signalToMarkers`へ漏れて壊れた
      コードを生成することを防ぐガード)。
- [ ] 5.6 `src/codegen.ts`の`generateFactory`が、`StructuralUnitBody`の
      `localDecls`をfactory関数本体の先頭(`__el__`確保の直後)で
      `let <name> = <init>;`として宣言する。新しいupdate関数は作らない
      ― 既存の`update()`(item仮引数がある場合に生成される)がテキスト/
      属性の再描画を担う既存ロジックをそのまま使う。
- [ ] 5.6b `body.localHandlers`のうち`writeDeclIds`が`ctx.localDeclIds`と
      交差するハンドラについて、既存の`updateNames`呼び出しに加えて
      bare `update()`呼び出しを追記する配線を追加する(同一ユニット直下
      限定なので関数宣言の巻き上げにより参照は曖昧にならない)。
- [ ] 5.7 テスト: リストアイテムへインライン化されたローカルsignalが
      モジュールスコープに一切現れないこと。
- [ ] 5.8 テスト: 同一ユニット直下でローカルsignalに依存する動的class
      属性バインディング(`class={editing() ? 'editing' : ''}`相当)が、
      そのユニットのローカルハンドラ発火後に正しく切り替わること。
- [ ] 5.8b テスト: ネストした構造ユニット(条件分岐)がリストアイテムの
      ローカルsignalに依存する場合、`(scope limit)`を含むcompile error
      で拒否されること(グローバルへ漏れないことの回帰確認)。
- [ ] 5.9 テスト: アイテムが複数あるとき、各アイテムのローカルsignalが
      互いに独立していること(1件のトグルが他のアイテムに影響しない)。
- [ ] 5.10 テスト: ルートsignalへの依存は本changeの対象外として引き続き
      `scope limit`で拒否されること(回帰確認)。

## 6. examples/todomvc.jsxの更新

**前提(実装前調査で判明)**: `examples/todomvc.jsx`は現行コンパイラでも
`{visibleTodos().length > 0 && (<ul>...)}`が親要素のsole childでないこと
(既存M5の制約、ADR-0014と無関係)で既にコンパイルが通らない。また
このフィクスチャの構造(条件分岐 > リスト > リストアイテム内の条件分岐)は
3ユニットの入れ子でM5.5の「1階層まで」を超える。編集モードのspan/input
入れ替え(UNRESOLVED-07)も本changeでは解決しない(セクション5の
「ネストユニットの祖先ローカルsignal依存」は明示的にscope limitのまま)。
よって本セクションは**フィクスチャ全体をコンパイル可能にすることを
目標にしない**。

- [ ] 6.1 `TodoApp`から`TodoItem`コンポーネントを切り出す: `todo`・
      `onToggle`等をpropsとして受け取り、`editingId`ハックを
      `TodoItem`内の`const editing = signal(false)`に置き換える。
      編集モードの表示切り替えはspan/input入れ替え(07、未解決のまま)
      ではなく、`class={editing() ? 'editing' : ''}`の動的class属性
      バインディング(実物のTodoMVCと同じCSSベースの編集インジケータ)
      にする ― これはセクション5で実装する「同一ユニット直下」の
      依存に収まる。
- [ ] 6.2 冒頭コメントを実態に合わせて更新する: UNRESOLVED-04は
      ADR-0014により解消・実装済みにする一方、フィクスチャ全体は
      (sole-child制約・3階層ネスト・UNRESOLVED-07により)引き続き
      コンパイルできないことを明記する。
- [ ] 6.3 `examples/todomvc.handwritten.js`との整合を確認する(手書き
      目標出力側の構造に変更が要るか確認し、要らなければその旨を記録する)。
- [ ] 6.4 同一ファイル内コンポーネント合成+ローカルsignalの動作を検証する
      専用のテストフィクスチャ(`test/`配下、sole-child制約や3階層ネスト
      を踏まない最小限の構成)を追加し、コンパイル成功+生成コードの
      実行結果(初期表示・ローカルsignal書き換え後のclass切り替え)を
      回帰テストする。`examples/todomvc.jsx`自体をコンパイルするテストは
      追加しない(6の前提より対象外)。

## 7. ドキュメント更新

- [ ] 7.1 `STATUS.md`のマイルストーン表・既知の制約(リストアイテム内で
      追跡signalを参照できない、UNRESOLVED-04関連の記述)を、本changeで
      実装された範囲(同一ユニット内ローカルsignalのみ許可)に合わせて
      更新する。
- [ ] 7.2 `ROADMAP.md`の§2 UNRESOLVED-04・§4(同一ファイル内合成)の
      「未実装」表記を実装済みに更新し、次のアクション欄の記述
      (「ADR-0014の実装が先で、次に触るとすれば9番の後」の注記)を
      整理する。
- [ ] 7.3 `docs/architecture.md`にインライン化前処理パスの位置づけ
      (compileComponentより前・render-tree走査は無変更)を追記する
      (該当箇所が無ければ追加、既にある場合はそのまま流用)。

## 8. 全体確認

- [ ] 8.1 `bun run check-all`(biome check --write && tsc --noEmit &&
      bun test)を実行し、全て通ることを確認する。
