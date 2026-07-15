## Why

ADR-0005・M5(change `m5-list-conditional-factory-closures`)は「リスト
アイテム内・条件分岐ブランチ内にさらにネストした構造ユニット」を明示的に
スコープ外とし、`compile:`+`(scope limit)`で拒否している。`examples/todomvc.jsx`
のUNRESOLVED(06)(条件分岐の中のリスト)・UNRESOLVED(07)(リストアイテムの
中の条件分岐)は実際にこのパターンで、TodoMVCフィクスチャの完全なコンパイル
を妨げている。M5のdesign.mdは「follow-up changeのdesign.mdで決める」と
明記して先送りしていた(Open Questions参照)。

## What Changes

- コンパイラ(`src/compiler/render.ts`・`src/compiler/analyze.ts`・
  `src/codegen.ts`)が、条件分岐ブランチの本体・リストアイテムの本体それぞれの
  中に、さらに1つネストしたリスト/条件分岐の構造ユニットを受理するようにする。
  既存のトップレベル向けfactory-per-unit実装をそのまま再帰適用する
  (2階層目まで)。3階層目以降のネストは引き続き`scope limit`で拒否する。
- ネストした構造ユニットの生死ポリシーは、既存のトップレベル条件分岐の
  「条件が変わるたびに古いbranchを`remove()`して新しいfactoryを呼び出す」
  パターン(新しい状態保持機構は作らない)をそのまま踏襲する。**BREAKING
  ではないが既存保証の境界を明確化**: 条件分岐ブランチ内にリストがネストする
  場合(06)、そのブランチが非選択になった瞬間、内側リストのkeyed Map全体が
  (フィルタ除外中の非可視アイテムも含めて)破棄される。これは
  `list-conditional-rendering`capabilityの既存要件「フィルタによる可視集合
  からの除外時は状態を保持する」の適用範囲を「そのリスト自身が実DOM上に
  マウントされ続けている間」に限定する形で明確化するものであり、`specs/`の
  デルタで境界条件として明記する。
- `examples/todomvc.jsx`のUNRESOLVED(06)/(07)を解消し、実際にネストした
  JSXへ書き換える。付随してUNRESOLVED(04)(アイテムごとのローカル編集状態)・
  UNRESOLVED(08)(編集中テキストの下書き保持先)は、07の実装で自然に解消
  するかを判断し、解消しない場合は理由を明記した上でスコープ外のままにする。
- 完了後、`STATUS.md`のM5.5行をDONEに更新し、`ROADMAP.md`の該当項目を実績
  として書き換える。

## Capabilities

### New Capabilities
(なし)

### Modified Capabilities
- `list-conditional-rendering`: 「ネストした構造ユニットのスコープ制限」
  要件を、1階層のネスト(リストアイテム内の条件分岐/条件分岐ブランチ内の
  リスト)を許可する形に置き換える。2階層以上のネストは引き続き拒否する
  要件として残す。「配列脱落とフィルタ除外の区別」要件に、内側リストが
  外側の条件分岐によって非マウントになった場合の境界条件(保持保証が
  及ばない)を追記する。

## Impact

- `src/compiler/render.ts`: JSXツリー走査で、条件分岐ブランチ本体・
  リストアイテム本体の中にさらに構造ユニットを見つけた場合の扱い
  (現状: scope limitで即拒否)を、1階層までは再帰的にfactory生成へ
  回すように変更する。
- `src/compiler/analyze.ts`: ネストした構造ユニット内の識別子解決・
  依存解析を、既存のトップレベル向けロジックに対して再帰的に適用できる
  ようにする。
- `src/codegen.ts`: `generateFactory()`・`generateConditionalUpdate()`・
  リストのkeyed diff生成が、ネストした構造ユニットのfactory/update関数を
  入れ子に生成できるようにする。
- `examples/todomvc.jsx` / `examples/todomvc.handwritten.js`: UNRESOLVED
  注記の更新、フィクスチャの書き換え。
- `openspec/specs/list-conditional-rendering/spec.md`: 要件の置き換え・追記。
- `STATUS.md` / `ROADMAP.md`: マイルストーン・ロードマップの実績更新。
