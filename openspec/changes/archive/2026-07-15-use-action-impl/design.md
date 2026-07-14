## Context

ADR-0011で`use={fn}`の設計は決定済み(識別子参照配線・ADR-0009解析機械の
適用+ネスト関数への再帰・返り値クロージャのリアクティブ配線・refは
作らない)。specは`openspec/specs/element-use-action/`に同期済み。
エスケープハッチ棚上げ(ADR-0010)により、`use=`はscope limitからの
公式な逃げ道(本体からのグローバル委譲)も兼ねる。

実装先の現状:

- `src/compiler/render.ts`: `collectAttrs()`が属性を「onXxxハンドラ/
  静的属性」の2分類で処理。`use`はJSXIdentifierだがハンドラ正規表現
  (`/^on[A-Z]/`)に合わないため、現状は「静的属性の式コンテナ値」として
  scope limitで拒否される。ここに第3分類を足す。識別子参照の解決は
  `resolveHandlerBody()`と同じ`handlerFns`を使う。
- `src/compiler/analyze.ts`: `analyzeHandlerExpr`/`analyzeHandlerBody`が
  ADR-0009の機械(識別子解決・書き込み書き換え・4文種検証・D3のreturn
  位置検証)を持つ。actionはこれを土台に「ネスト関数本体への再帰書き換え」
  と「返り値クロージャの分離・依存解析」を足す。
- `src/codegen.ts`: top-levelマーカーは`__markers__`から取得。
  `mountComponent`/`hydrateComponent`の本体は共有行の組み立て
  (配線→初期`update_*`)。

## Goals / Non-Goals

**Goals:**

- top-level要素の`use={fn}`のコンパイル受理・解析・コード生成。
- 返り値クロージャの依存解析と`update_*`への静的配線・mount時初期実行。
- ADR-0011未決定2件の裁定(属性名・初期実行タイミング)。

**Non-Goals:**

- リストアイテム/条件分岐ブランチ内の`use=`(scope limitで拒否 —
  Decision 3)。
- JSX型定義(`JSX.IntrinsicElements`の`use`宣言)— Decision 6で先送り。
- reactive params・複数action・cleanup(ADR-0011未決定事項のまま)。

## Decisions

### 1. 属性名は`use`で確定する

ADR-0011未決定事項の裁定。代替候補`action=`は`<form action=>`・
`<button formaction=>`という実HTML属性と衝突し、静的属性(M4)との
判別が属性名だけでできなくなる。`use`はHTML属性として存在せず、
Svelte前例で読者の推測も効く。確定。

### 2. 返り値クロージャの初期実行は「action呼び出し直後」

ADR-0011未決定事項の裁定。生成コードのmount/hydrate末尾で
`__use_<markerId>__ = setup(el)`を実行した直後に
`if (__use_<markerId>__) __use_<markerId>__()`で1回実行する。つまり
順序は「マーカー収集 → ハンドラ配線 → 初期`update_*`(populate)→
action呼び出し+返り値クロージャ初期実行」。

- 要素接続後の保証: この位置なら要素は`container`配下に接続済み
  (specの「呼び出し時点でDOM上に存在」)。
- populateより後にする理由: actionが観測するDOM(テキスト等)が
  初期値で埋まった状態を見せる。リスナー装着(action本体)とpopulateの
  間に相互作用はない(mount中にイベントは発火しない)。
- `update_*`側の配線は`if (__use_<markerId>__) __use_<markerId>__();`と
  ガード付きで生成する。populate(action呼び出し前)に走る`update_*`が
  未初期化変数を呼ばないため。

### 3. リスト/条件分岐ユニット内の`use=`は本changeではscope limitで拒否

返り値クロージャの配線が理由。top-levelでは「クロージャ1個↔
`update_*`への静的な呼び出し行」で済むが、factoryインスタンスは動的に
増減するため、`update_*`から生きているインスタンスのクロージャ集合への
動的レジストリ(登録・破棄時の解除=teardown問題)が必要になる。
これはADR-0005以来「作らない」としてきた機構そのもの。実需(アイテム内
canvas等)が出た時点で、keyed Mapのhandle経由の配線を別changeで設計する。
エラーは`compile: use= inside list/conditional units is not supported
yet (scope limit)`の形式。

### 4. action本体の解析はADR-0009の機械をそのまま使い、拡張は2点だけ

1. **ネストした関数本体への再帰**: 関数式/arrow(式の中に現れるもの)の
   本体にも同じ書き換え(signal読み→プレーン読み、書き込み→代入+
   `update_*`)と同じ4文種検証を再帰適用する。特別扱いの層を増やさない
   (ADR-0011決定4「解析層を二重に設計しない」)。
2. **返り値クロージャの許可**: ADR-0009は「値を返すreturn」を拒否するが、
   action本体の**トップレベルの`return <関数式>`だけ**は返り値クロージャ
   として許可する(引数を持つ関数式の返却は拒否 — specのシグネチャは
   引数なし)。返したクロージャ本体は依存解析(signal/derived読みの収集
   →`resolveToSignals()`でroot signalへ展開)の対象になり、ここだけが
   `update_*`に配線される(位置的リアクティビティ)。ネスト関数内の
   `return`は通常の関数の返り値でありこの規則の対象外。

ADR-0009 D3(追跡書き込みより後ろのreturn拒否)はaction本体にも
そのまま効く。本体トップレベルで書き込みをしてから`return closure`する
形は拒否されるが、actionの書き込みは通常ネストしたリスナー内にあるため
実害は小さい(拒否メッセージが誘導する)。

### 5. codegen: actionソースは書き換え済み本体を関数として出力する

ハンドラと同じ扱い(逐語コピーではない — 棚上げした`<Escape>`との
1軸の違いがここ)。モジュールスコープに
`let __use_<markerId>__;`を宣言し、mountComponent/hydrateComponentの
共有行でaction本体(書き換え済み)を実行して返り値を代入する。actionが
`return`を持たない場合、配線行・ガード行は一切生成しない(ADR-0004:
使われない機構を出力しない)。

### 6. JSX型定義は本changeに含めない

authored `.jsx`は現状tsconfigの型検査対象外で、`signal`/`render`/
ハンドラ属性を含め型宣言が一切存在しない。`use`だけ型を付けても
エディタ体験は成立しない(ファイル全体が未検査のまま)。specの
「要素ごとの型宣言」要件は維持し、authored codeの型検査基盤
(`types/jsx.d.ts`+examplesのtsconfig組み込み)を一括で整える別change
で実装する。ROADMAPに論点として積む。

## Risks / Trade-offs

- [ユニット内`use=`の拒否はTodoMVCパリティの穴を1つ増やす] → 既存の
  UNRESOLVED(ref・動的属性)と同種の「実需が出たら設計」枠。scope limit
  メッセージで明示的に拒否するので静かに壊れることはない。
- [返り値クロージャの依存が空(signalを読まない)場合] → 配線先が無い
  だけで合法。mount時の初期1回実行のみ生成する。
- [action本体のトップレベル直書き込み+return closureがD3で拒否される] →
  Decision 4の通り受け入れ。エラーメッセージは既存D3のものを流用する。
- [`use`と同名の静的属性を書きたいケース(実HTML属性に`use`は無いが
  SVGの`<use>`要素は存在する)] → 要素名`use`(SVG)と属性名`use`は
  衝突しない。SVG対応自体が未実装なので現時点では問題にならない。

## Open Questions

(なし — ADR-0011の実装系未決定2件はDecisions 1〜2で裁定、型宣言は
Decision 6で明示的に先送り)
