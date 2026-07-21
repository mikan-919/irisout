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
- [ ] 5.4 `ctx`に「このDeclIdはどのユニット(またはroot)で宣言された
      ローカルsignalか」を引ける追跡(例:
      `localDeclOwnerUnit: Map<DeclId, MarkerId | 'root'>`)を追加する。
- [ ] 5.5 `renderStructuralUnitBody`のローカルマーカー依存チェック
      (現状: 追跡signal依存を無条件scope limit)を、依存先が「同一ユニット
      所有のローカルsignal」の場合のみ許可するよう変更する。それ以外
      (ルートsignal、別ユニット/祖先ユニットのローカルsignal)は従来どおり
      拒否する。
- [ ] 5.6 `src/codegen.ts`の`generateFactory`が、`StructuralUnitBody`の
      `localDecls`をfactory関数本体の先頭で`let <name> = <init>;`として
      宣言し、そのローカルsignalに依存するローカルマーカー(テキスト/
      ネストした条件分岐/属性バインディング)を更新するローカル
      `update_<name>()`関数を生成し、対応するローカルハンドラの書き込み後に
      それを呼び出す配線を追加する。
- [ ] 5.7 テスト: リストアイテムへインライン化されたローカルsignalが
      モジュールスコープに一切現れないこと。
- [ ] 5.8 テスト: 同一ユニット内のローカルsignalに依存するネストした
      条件分岐(`editing() ? <input/> : <span>`相当)が、そのユニットの
      ローカルハンドラ発火後に正しく切り替わること。
- [ ] 5.9 テスト: アイテムが複数あるとき、各アイテムのローカルsignalが
      互いに独立していること(1件のトグルが他のアイテムに影響しない)。
- [ ] 5.10 テスト: ルートsignalへの依存は本changeの対象外として引き続き
      `scope limit`で拒否されること(回帰確認)。

## 6. examples/todomvc.jsxの更新

- [ ] 6.1 `TodoApp`から`TodoItem`コンポーネントを切り出す: `todo`・
      `onToggle`等をpropsとして受け取り、`editingId`ハックを
      `TodoItem`内の`const editing = signal(false)`に置き換える。
- [ ] 6.2 UNRESOLVED-04の注記(ADR-0014解消済み・実装済みに更新)と
      冒頭コメントを、本change実装後の実態に合わせて更新する。
- [ ] 6.3 `examples/todomvc.handwritten.js`との整合を確認する(手書き
      目標出力側の構造に変更が要るか確認し、要らなければその旨を記録する)。
- [ ] 6.4 更新した`examples/todomvc.jsx`が実際にコンパイルできることを
      確認する回帰テストを追加する(golden-output/regression testsの
      既存の仕組みに乗せる、`generated-output-regression-tests`参照)。

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
