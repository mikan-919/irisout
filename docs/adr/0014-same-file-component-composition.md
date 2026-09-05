# ADR-0014: 同一ファイル内の複数コンポーネント合成(構造ユニットのコンパイル時インライン化)

## ステータス

**決定済み・実装済み**(change `same-file-component-composition`。
2026-07-21 grilling、ROADMAP.md §4・§2 UNRESOLVED-04の続き)

## コンテキスト

実装前は、`<Component/>`のようなJSXタグ参照は同一ファイル内であっても
`compile: component references (<${tagName}/>) are not supported yet
(scope limit)`で拒否されていた(`packages/compiler/src/compiler/render.ts`)。
CONCEPT.v3.mdは「コンポーネント」「props」をirisoutの責務として明言しており、
このADRで同一ファイル内の範囲を実装した。

ROADMAP §4は「複数コンポーネント合成・複数ファイル・ビルド時実行の切り分
け」を一括りの論点として提起していたが、grillingの結果、**同一ファイル内
の合成は複数ファイル対応と切り離して先に決められる**ことが分かった
(`findRootComponent()`は既に「他から一度もJSXタグ参照されない関数」を
rootとして正しく選び出しており、`TodoItem`のような子コンポーネントは
自動的にroot候補から除外される ― `packages/compiler/src/compiler.ts`。変更が要るのは
`compileComponent`が`<TodoItem/>`に到達した時点の拒否ロジックだけ)。

具体的な検証対象は `apps/examples/todomvc.jsx` の `TodoApp` → `TodoItem`
分割。これにより ROADMAP §2 UNRESOLVED-04(アイテムごとの編集状態を
表す暫定策 ― コンポーネント全体で1つの`editingId` signalを使い回す
「同時1件編集」依存のハック)も同時に解消する。

**主な動機はアプリ全体への汎用的なUI合成ではなく、構造ユニット(リスト
アイテム/条件分岐ブランチ)の中身を名前付きで切り出すこと**(`CONTEXT.md`
「コンポーネント」参照)。context・モジュールスコープ共有stateが要る
「コンポーネントがアプリ全体に散らばる」フェーズはROADMAP §5に残したまま、
本ADRのスコープには含めない。

## 決定

### 1. スコープは同一ファイルのみ

複数ファイル・import解決・ファイル間のビルド時実行順序(ADR-0001未決定
事項)は本ADRの対象外。ROADMAP §4に論点として残す。

### 2. 呼び出しはコンパイル時ASTインライン化、実行時オブジェクトなし

`<TodoItem todo={t} onToggle={fn} />`は、呼び出し箇所へ`TodoItem`本体の
ASTを展開する形でコンパイルする。`TodoItem`はビルド時にも実行時にも
「関数として呼ばれる」ことは一度もない ― ADR-0004「コンポーネント境界は
ビルド後に消える」を最も文字通り実装する。

### 3. インライン化は render-tree 走査より前の独立した前処理パス

`compileComponent`(既存のrender-tree走査、M1〜M6)より**前**に、
コンポーネント参照を解決・展開する前処理を追加する。既存の走査自体は
コンポーネントという概念を知らないままでよい。理由:
- `key`属性は「`.map()`直下の一番外側のJSX要素」を前提にしている。前処理パスなら
  展開後にちょうど元の要素(`<li>`)が
  その位置に来るため、M5/M5.5側は無変更で済む。
- ADR-0013(動きゾーン関数への呼び出し追跡)がそのまま使える ―
  `TodoItem`内の`onClick={() => onToggle(todo.id)}`は、propsの識別子
  置換後`onClick={() => toggleTodo(todo.id)}`になり、これは呼び出し元
  コンポーネントの動きゾーン関数への呼び出しとして ADR-0013 が既に扱う
  形と一致する。

### 4. propsは分割代入、ランタイムprimitiveを新設しない

`function TodoItem({ todo, onToggle }) { ... }`の形で受け取る。propsは
実行時オブジェクトを経由しない純粋なコンパイル時の識別子置換であり、
参照している式が呼び出し箇所の式へそのまま書き換わる。置換先が
signal呼び出しなら既存の依存グラフに、リストアイテムのitemパラメータ
ならitem-level `update()`(ADR-0005)に、そのまま乗る。

分割代入を避ける既存の理由(ADR-0009: ハンドラ引数の書き込み追跡コスト)
は、propsが読み取り専用の置換対象である以上当てはまらない。

### 5. 名前衝突は検出時のみコンポーネント名でリネーム

ルートsignalの素の変数宣言・`update_<name>()`・識別子参照ハンドラの
巻き上げ(ADR-0006/0008/0013)はいずれもmodule scope前提で、複数
コンポーネントが同名の識別子を使うと衝突しうる(同じコンポーネントを
複数箇所で呼んだ場合に限らない ― 別々のコンポーネントが両方
`const count = signal(0)`と書くだけでも起きる)。

実際に衝突する組み合わせが検出されたときだけ、衝突した側をコンポーネント
名で明確にリネームする(例: `TodoItem_count`)。常時リネームはしない ―
衝突が無い大多数のケースまでプレフィックスで埋めると、ADR-0004の
「経験豊富なエンジニアの手書き」から離れた出力になる。

この方針により、コンポーネントの呼び出し箇所を1箇所に制限する必要は
ない(衝突は呼び出し箇所の数ではなく、識別子の重複そのものが原因の
ため)。

### 6. ローカルsignal(構造ユニットへインライン化されたコンポーネントの状態)

コンポーネントの変数ゾーンで宣言されたsignal/derivedが、構造ユニット
(リストアイテム/条件分岐ブランチ)へインライン化された場合、その
`update_<name>()`相当はfactoryクロージャ内のローカル関数として生成され、
module scopeには一切出ない(`CONTEXT.md`「ローカルsignal」)。JSの
クロージャがインスタンスごとの分離をタダで提供するため、名前衝突の
対象にもならない。

この仕組みにより、`TodoItem`に`const editing = signal(false)`を持たせ、
当時のUNRESOLVED-04だった`editingId`ハック(コンポーネント全体で1つのsignalを
使い回す「同時1件編集」依存の暫定策)を、アイテムごとに独立した本来の
ローカル状態へ置き換えられる。さらに`recursive-structural-authoring`
(2026-09-05)で、同じitem内のnested conditional/Listがこのlocal signalを
読む場合も、local signalのDeclIdをglobal依存表へ漏らさず、宣言factoryの
updateへ接続する形で許可した。直接のテキスト・属性がroot signalを読む制限と、
字句スコープ外localの拒否は残る。

### 7. スコープ外(scope limitで拒否)

- **children/slot**: `<Component>...</Component>`のように子JSXを渡す形。
  実需が出るまで対応しない。
- **再帰・循環参照**: インライン化前処理が展開中のコンポーネント名の
  集合を持ち、再訪問を`compile: recursive component reference "X" is
  not supported yet (scope limit)`で拒否する。深さ制限等の緩和は実需が
  出るまでしない。

## 検討した代替案

- **ランタイムprops wrapper(`prop(props)`、Svelte 5の`$props()`相当)**:
  destructureしても reactivity を保つための専用primitiveとして検討した。
  インライン化モデルの下では、propsは既存の依存グラフ/item-level
  `update()`にそのまま乗るため不要と判断し却下(ADR-0004: ソースが
  要求していない機構を足さない)。
- **常時リネーム(全識別子にコンポーネント名を機械的に前置)**: 衝突が
  無い場合にも出力にnoiseを持ち込むため却下。
- **呼び出し箇所を1箇所に制限**: 名前衝突の症状の一部(識別子参照
  ハンドラの巻き上げ)にしか効かず、根本原因(コンポーネントが2つ
  あるだけでルートsignal/`update_*`が衝突しうること)を解決しないため
  却下。
- **複数ファイル対応と同時設計**: モジュール解決・ファイル間のビルド時
  実行順序(ADR-0001未決定事項)を同時に決めることになり、合成モデル
  そのものの検証と論点が二重化するため却下。ROADMAP §4に別軸として
  残す。
- **走査中にコンポーネント解決を埋め込む**(前処理パスにしない): M1〜M6
  の`render.ts`/`analyze.ts`/`decl-graph.ts`全部にコンポーネント解決の
  分岐を持ち込むことになり、変更範囲が前処理パス案より桁違いに大きい
  ため却下。
