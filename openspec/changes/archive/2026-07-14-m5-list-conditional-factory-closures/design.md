## Context

ADR-0005は方針決定済みだが実装は未着手。`examples/todomvc.jsx`(目標入力)と
`examples/todomvc.handwritten.js`(目標出力)には、ADR-0005が明示的に
スコープ外とした「ネストした構造ユニット」に該当するパターンが実際に
含まれている:

- UNRESOLVED(06): `{visibleTodos().length > 0 && (<ul>...)}` ―
  リストが条件分岐の中にネストしている。handwritten側は実際のDOM
  着脱ではなく、常に`<ul>`を描画したうえで`hidden`プロパティで
  妥協している(`todomvc.handwritten.js:86-93`)。
- UNRESOLVED(07): 編集モードの`span`↔`input`入れ替え ― `<li>`(リスト
  アイテム)の中にさらに条件分岐が要る。handwritten側はtemplateの
  再クローンではなく都度DOM生成+display切り替えで妥協している
  (`todomvc.handwritten.js:145-181`)。

いずれも「妥協」と明記されている通り、正式なfactoryパターンでは未解決。
本designはADR-0005の実装範囲を確定し、これら2件を含めるかどうかを判断する。

## Goals / Non-Goals

**Goals:**
- ADR-0005決定1〜4(`<template>`スタンプ、factory関数、keyed reuse、
  teardown不要方針)を実装する。
- 条件分岐・リストそれぞれを、コンポーネント直下(または互いに独立した
  トップレベルのUIゾーン内)の構造ユニットとして実装する。
- UNRESOLVED(05)(フィルタ非表示と削除の区別)をkeyed reuseの仕様として
  確定する。

**Non-Goals:**
- UNRESOLVED(06)(リストが条件分岐にネストする形)・UNRESOLVED(07)
  (リストアイテム内にさらにネストした構造ユニット)の実装。ADR-0005が
  明示的にスコープ外としたケースであり、本changeでも据え置く(下記
  Decisions参照)。
- UNRESOLVED(04)(アイテムごとのローカル編集状態のauthoring API表現)・
  UNRESOLVED(08)(編集中テキスト下書きの保持先)。07が未解決の間は
  対応する編集UIそのものが構造的に作れないため、07とまとめて後続に送る。
- `examples/todomvc.jsx`の完全なコンパイル成功。本change単体では
  達成しない(下記参照)。

## Decisions

### 1. ネストした構造ユニット(06/07)は据え置く

ADR-0005のスコープ制限(「まずは1階層のみ」)を本changeでも維持する。
理由:
- 07(リストアイテム内の条件分岐)はADR-0005が名指しでスコープ外とした
  ケースそのもの。
- 06(条件分岐内のリスト)は一見単純だが、handwritten側が実際のDOM
  着脱を避けて`hidden`プロパティに逃げている通り、「条件分岐がfalseに
  なった瞬間、中のリストのkeyed reuse状態(Map)をどう扱うか
  (破棄するか、保持したままDOMだけ隠すか)」という新しい設計判断を
  要する。これはADR-0005が想定した「1階層のみ」の単純な直交ではなく、
  親子間の状態保持ポリシーという別の論点であり、本changeの実装
  (1階層のfactory)が固まってから改めて設計する方が確実。
- 結果として`examples/todomvc.jsx`は本change単体では完全にはコンパイル
  できない(06/07に該当する箇所がscope limitで拒否され続ける)。
  ロードマップの「M5設計時にスコープを決める」を、06/07は次段階に送る
  形で確定する。フィクスチャのUNRESOLVED注記はtasks.mdで更新する。

代替案として「06だけ先に含める」ことも検討したが、`hidden`方式(常に
描画し表示だけ切り替える)を正式仕様にするか、実際にDOM着脱するかの
判断が必要で、これ単体でも1つの設計トピックになる規模のため見送った。

### 2. UNRESOLVED(05): 削除とフィルタ非表示の区別をkeyed reuseの仕様にする

`update_<list>()`のkeyed diffは、「配列(例: `todos()`)からkeyそのものが
消えた」場合のみMapからエントリを破棄し、DOM要素を`remove()`する。
「フィルタ適用後の可視集合(`visibleTodos()`)からは外れたが、元の配列
には残っている」場合は、Mapのエントリ・DOM要素の状態を保持したまま
表示から除外する(具体的な除外手段 ― `hidden`か着脱かは06と同じ論点を
含むため、本changeでは「配列からの脱落だけがkey破棄のトリガーである」
という区別そのものを仕様として確定し、除外手段の実装は06の据え置きに
合わせて後続で扱う)。

### 3. `<template>` + `cloneNode`によるスタンプ機構

ADR-0005決定1の通り実装する。ラッパー要素は挟まず、クローンした実要素を
直接親の子にする。

### 4. factory関数の生成

リストアイテムテンプレート・条件分岐の各ブランチについて、既存の
`__itemInner_${id}`/`__itemHtml_${id}`(`src/codegen.ts`、文字列スタンプ
専用)を、ADR-0005決定2の1関数(クローン取得+ローカル変数+`update_*`+
`addEventListener`登録)に置き換える。

### 5. keyed reuseへの更新

`update_<list>()`を、既存keyはfactoryハンドルの再利用、新規keyのみ
factory呼び出しに変更する(ADR-0005決定3)。

## Risks / Trade-offs

- [06/07を据え置くことで、TodoMVCフィクスチャが本change後も完全には
  コンパイルできない] → 想定通り。ロードマップの「M5のその後」の
  ref設計・動的属性バインディングと同様、後続changeとして計画する。
  STATUS.mdのM5マイルストーンは「1階層の基本実装」の完了をもって
  DONEとし、06/07は別マイルストーン(M5.5相当)として記録する。
- [05の区別(配列脱落 vs フィルタ除外)を仕様化しても、除外手段の実装が
  06と結合しているため、本change単体では見た目上「フィルタ切り替えで
  非表示にする」機能が完成しない] → tasks.mdでは05の区別ロジック
  (Map操作)までを実装対象とし、「除外の描画反映」は06のfollow-upで
  扱う旨を明記する。

## Open Questions

- 06(条件分岐内のリスト)を実際にDOM着脱で解決するか、handwritten側の
  `hidden`妥協を正式仕様として採用するかは、follow-up change側の
  design.mdで決める。
- `perf-bench-todomvc-vs-react`changeの実測結果が出ている場合、keyed
  reuseのMap実装(Decision 5)のデータ構造選択(`Map` vs 配列+線形探索等)
  に影響するかを確認する。
