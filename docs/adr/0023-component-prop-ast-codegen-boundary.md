# ADR-0023: 変換済みprops式のASTコード生成境界

## ステータス

決定済み(2026-09-05)

## コンテキスト

同一ファイルコンポーネントのpropsは、呼び出し先のbinding参照を呼び出し元の
実引数式のクローンへ置換する(ADR-0014)。クローンしたノードの`start`/`end`は
呼び出し元ソースの位置を指すため、置換後の参照が三項演算子・メンバー式・二項
演算子などの内部にあると、呼び出し先の式を元ソースから切り出す既存のEdit方式
では古いprops識別子を含むコードが生成される。値なし属性から作る`true`には
元ソースの位置自体がない。

一方、すべての式をASTから再生成すると、未変更部分の書式を保つ既存の利点を
失う。propsを実行時オブジェクトへ移すことも、コンポーネントを実行時に残すことも
ADR-0014の方針に反する。

## 決定

1. `inline-components.ts`は、インライン化されたクローンとそこから作った
   ノードを変換済み集合へ記録する。bindingに基づくprops置換と、名前衝突時の
   識別子変更は従来どおり行う。
2. `analyze.ts`は、変換済みノードを含む式・ハンドラ本体・action本体を
   `ast-codegen.ts`へ渡し、式全体をBabel ASTからコード生成する。生成前に
   signalの読み取り・書き込み変換と識別子変更をASTへ反映するため、元ノードの
   `start`/`end`を文字列切り出しの根拠にしない。
3. ビルド時実行用`sourceRendered`と本番出力用`rendered`は別のAST書き換えとして
   生成する。前者はsignal呼び出しを保ち、後者は読み取りを裸の変数へ変換する。
4. 変換済みノードを含まない式は従来どおりEdit方式を使う。これにより、既存の
   出力書式を保ちつつ、props置換が式の位置や実引数の名前に依存しない。

## 対象外

- propsのspread、非shorthand分割代入、children/slot、複数ファイル合成は
  引き続き別のscope limitである。
- コンパイラ全体のAST変換や、実行時propsオブジェクトは導入しない。

## 結果

`<Foo item={t} />`の`item.done`、メンバー式・添字式・呼び出し式の実引数、
三項演算子・二項演算子・ハンドラ内部のprops参照、`<Foo enabled />`の`true`を
コンパイル時に安全に置換できる。生成コードに存在しない元props識別子が残ることは
回帰試験で検証する。

同じAST境界は、list itemへ展開したcomponentの動きゾーンfunctionと`use=` actionにも
適用する。インライン化処理は子componentのfunction宣言をitem blockへ移し、render-tree
走査はその宣言をitem factoryの字句スコープで解決する。actionのbody/resultは変換後の
ASTから生成し、各itemのfactory handleがaction resultを保持する。これにより同じ
componentを複数itemへ展開しても、props、local signal、actionのupdate/destroyが
item間で共有されない。
