# ADR-0011: `use={fn}`属性で要素にactionを接続する(refは作らない)

## ステータス

**決定済み・実装済み**(change `use-action-impl`)。属性名`use`の確定・
返り値クロージャの初期実行タイミングの裁定は、下記「未決定事項」ではなく
実装change `use-action-impl` の design.md Decision 1/2 を参照。

## コンテキスト

ADR-0008はref(`ref={...}`)の設計を未決定事項として残し(条件分岐配下で
要素が存在しないときのハンドル挙動)、ROADMAP.mdのUNRESOLVED(01)が
対応する論点だった。2026-07-14の設計相談で以下が言語化された:

- Svelte Actionの本質は制御の向きの逆転: 「箱を宣言して裏から注入」
  (React ref)ではなく「要素が存在した瞬間に関数が呼ばれる」。存在保証は
  呼ばれたという事実そのもので、nullが型から消える。
- irisoutはこの理想形を完全に実装できる位置にいる: 実行順(mount→
  factory→リスナー装着→update)をコンパイラが掌握しているため、順序の
  証明で型からnullを消せる(Reactはrenderがmount前に走りうるため原理的に
  不可能)。
- canvas ctxのような「要素由来の値」はactionクロージャの外に出さず、
  状態をクロージャの中に流し込む(向きの逆転)。ADR-0005のfactory
  クロージャと同一イディオムの3回目の再利用(リストアイテム・条件分岐
  ブランチ・action)。

## 決定

### 1. 設計原則: 穴のない宣言・プレースホルダーの向き・位置的リアクティビティ

以下3原則をauthoring APIの統治原則として明文化する(ADR-0004の
コンパイラ統治原則のauthoring API版):

1. **穴のない宣言**: 「あとで埋まる箱」は存在しない。UIより前には
   完成した値だけが置かれ(const/signal — 生まれた瞬間から値を持つ)、
   UIより後には中身の供給だけが置かれる(function宣言 — UIが宣言した
   名前に差し込まれる)。render()がその境界線である。
2. **プレースホルダーの向き**: 名前はUIが宣言し、後段が差し込む。
   `{count()}`(テキスト穴←signal)、`onClick={handle}`(動きの穴←
   function宣言)、`use={setup}`(振る舞いの穴←function宣言)はすべて
   同じ向き。逆流(UIより前に宣言した箱への裏からの注入)はない。
3. **位置的リアクティビティ**: リアクティブ性は「どう読むか」ではなく
   「どこに書いたか」でコンパイル時に決まる。購読という実行時概念は
   存在しない。リアクティブな置き場所はJSXの穴・derived本体・actionの
   返り値クロージャのみ。それ以外(ハンドラ本体、action本体のネスト
   した関数=イベントリスナー・rAFループ等)でのsignal読みは常に
   「その瞬間の現在値」であり、`untrack()`のような脱出口は不要。

文字通りの「UI先頭」(render()をファイル先頭に置く)は実現しない:
constは巻き上がらないため、JSX内の`{count()}`が後方のconstを参照すると
TDZ(TS2448)でエディタの型検査が壊れる。ADR-0008の案(a)を殺したのと
同じ「コンパイラ側では直せない弱点」であり、原則1の形(値は前・供給は
後)が合法TSで実現可能な最良形である。

### 2. `use={identifier}`属性の採用

要素にactionを接続する属性として`use`を採用する:

```jsx
function Chart() {
  const count = signal(0)

  render(<canvas use={setup} />)

  function setup(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')!          // null無し。mount後保証
    canvas.addEventListener('click', () => {
      count(count() + 1)                          // 書けばupdate_*が付く
    })
    return () => { /* count()を読んで再描画 */ }   // リアクティブ面
  }
}
```

- 配線ルールはADR-0008のハンドラと同一: 動きゾーン(render()より後ろ)の
  function宣言への識別子参照。inline arrowも同じ理由(UIゾーン内は
  「UI以降」)で許容する。
- 1要素につきuseは1つ(JSX属性の一意性に従う)。複数actionの実需が
  出たら配列受けを検討する。

### 3. シグネチャと型: `(el: 要素型) => void | (() => void) | { update?, destroy? }`

- 第1引数はその要素。`JSX.IntrinsicElements`で要素ごとに
  `use?: (el: HTMLCanvasElement) => void | (() => void) | { update?, destroy? }`と宣言することで、
  **null無しの正確な要素型**が素のTSの代入可能性チェックで検査される。
  型の抽出(infer)は不要 — 宣言側に正解の型があるため、通常の検査方向に
  乗るだけ。エディタ型・rename・go-to-defが効く(ADR-0008の選定基準)。
- 返り値は**引数なしの再描画クロージャ**(または無し)を既存形式として維持する。
  コンパイラは返り値クロージャの依存(signal読み)を解析し、該当する`update_*`から
  呼び出すコードを生成する。mount時にも1回初期実行する。値の受け渡しのための
  パラメータは持たない — signalはinstance専有のプレーン変数なので、クロージャは
  直接現在値を読む。
- 外部リソース(タイマー、購読、document listener等)をactionが確保する実需に応じ、
  追加形式`{ update?: () => void; destroy?: () => void }`を採用する(ADR-0022)。
  `update`は既存の関数返り値と同じく初回+依存signal更新時、`destroy`はcomponent
  `unmount()`時だけ呼ぶ。関数返り値をcleanupとして再解釈しない。

### 4. 本体の解析: ADR-0009の機械を適用する

action本体はADR-0009のハンドラ本体と同じ解析(signal読みの書き換え・
`signal(x)`→代入+update_*付加・文種検証)を受ける。唯一の拡張は
**ネストした関数(addEventListenerのコールバック、rAFループ等)の本体へ
再帰的に同じ書き換えを適用する**こと。ただし原則3(位置的
リアクティビティ)により、update_*への配線対象になるのは返り値
クロージャだけで、ネストした関数は書き換えのみ(現在値読み+書き込み時の
update付加)を受ける。

### 5. 返り値クロージャのリアクティブ配線と destroy

actionが引数なしのクロージャを返す場合、コンパイラはその依存
(signal/derived読み)を解析し、該当するすべての`update_*`からその
クロージャを呼び出すコードを生成する。生成コードはmount時の初期化でも
このクロージャを1回実行する。

`{ update, destroy }` object を返す場合、`update`だけを上記の依存グラフへ登録し、
`destroy`はcomponent instanceの`unmount()`から一度だけ逆順に呼び出す。既存の
関数返り値は常にupdateとして扱い、cleanupへ変換しない。instance lifecycleと
DOM/marker/List stateの解放範囲はADR-0022で定める。

### 6. refは作らない: 要素アクセスは3チャネル

要素は「値」としてコードに渡せない。「穴のない宣言」原則の系として、
ref値はどのゾーンにも合法な置き場所を持たない(変数ゾーンに置けば
mount前は空=穴、動きゾーンには値宣言が置けない)。要素は**関数の引数と
してのみ到着する**:

1. `use={fn}` — その要素自身(mount時1回、型付き・null無し)。
2. `e`(ADR-0009) — イベントの要素と、プラットフォームの要素関係
   グラフ(`e.currentTarget`、`.form`、`form.elements`、`.closest()`)。
   「Addボタンがinputの値を読む」型はformが束ねて`e`が運ぶ
   (`new FormData(e.currentTarget)`)。draft signalへの吸い上げ
   (controlled componentの再発明)はしない。
3. actionの返り値クロージャ — 状態変化に反応して要素を触る経路
   (フォーカス、再描画)。

残余=「構造的に無関係な要素への命令形の指示」は以下の順に倒す:

- (a) **HTML id配線**: `popovertarget`、`commandfor`(Invoker Commands)、
  `label for`、`form=`。プラットフォーム公式の要素間参照で、静的属性
  としてM4で実装済み — コンパイラ関与ゼロ。dialog/popover開閉という
  このカテゴリの最頻出組はここで死ぬ。
- (b) **状態への改名**: 命令が変えるはずだった状態に名前を付ける
  (`playing`、`center`)。生成コードのupdate_*は最初からコマンドバス
  であり、状態経由はその素直な写像。命令に見えて状態名が思いつかない
  ケースは大抵ターゲットがインスタンス(map、チャート)で、
  インスタンスを抱えるactionが状態に反応する形が健全。
- (c) **カウンタイディオム**: どうしても状態にならない一発コマンドは
  バージョンカウンタsignalで表す(不格好だが書ける)。

**(c)が頻出する実例がフィクスチャに現れた時点で、第4チャネル
(動きゾーンの関数へ要素を追加引数として配線する「牙抜きref」— 値では
なく引数)を設計する。** 却下ではなくトリガー条件付きの先送り。

### 7. scope limit苦情のtriage手続き

「この形で書きづらいものはUI/UX/コード設計のいずれかが間違っている」
という仮説は、コンパイラがコンセプト(手書きパリティ)に忠実であるほど
真に近づく極限の定理であり、未実装が残る現時点では偽である(例:
UNRESOLVED(06)/(07)は正当なUXだが書けない=コンパイラの穴)。両者を
区別するため、scope limitへの苦情は以下でtriageする:

- Q1: 熟練者はこれを綺麗なvanilla JSで手書きできるか?
  - YES → コンパイラの穴。ロードマップ行き。
  - NO(手書きでも歪む)→ Q2へ。
- Q2: プラットフォームに既存イディオムがあるか?
  - YES → 車輪の再発明。アンチパターンとして記録。
  - NO → 本物の新種。新チャネル設計のトリガー。

仮説そのもののCONCEPT.v2.mdへの昇格の要否はユーザー判断待ち(下記
未決定事項参照)。

### 検討した代替案と却下理由

- **ref primitive(値の箱)** — `const x = ref()`で宣言し`x()`で要素を
  取得する signal 同型のAPI。「穴のない宣言」原則が構造的に禁止する:
  変数ゾーンに置けばmount前は空(=穴)、動きゾーンには値宣言が置けない。
  ref値が合法に存在できるゾーンがない。却下。
- **属性名`on=`** — `onClick`系のイベントハンドラ属性群と視覚的に衝突し、
  「イベントに反応する」ものと誤読される。却下。
- **属性名`mount=`** — `<Escape mount={...}>`(ADR-0010)が既に「管理外に
  渡す」意味で使っており、`use=`(解析対象・状態と同期)と意味が逆なのに
  同じ属性名になる。却下。
- **返り値=cleanup(Svelte 5 attachmentsと同型)** — 既存の関数返り値は
  update closure として実装済みで、cleanupへ再解釈すると authored code の意味が
  変わるため却下。外部リソースの明示的な解除は、後から追加した object 形式の
  `destroy` に限定する(ADR-0022)。
- **`untrack()`のような脱出口primitive** — 位置的リアクティビティ原則
  により、そもそも「読んだら自動購読される」実行時概念が存在しない
  (どこに書いたかで決まる)。脱出する対象がないため不要。却下。
- **文字通りの「UI先頭」(render()をファイル先頭に置く)** — constは
  巻き上がらないため、JSX内の`{count()}`が後方のconstを参照すると
  TDZ(TS2448)でエディタの型検査が壊れる。ADR-0008で案(a)を殺したのと
  同じ「コンパイラ側では直せない弱点」。却下。

## この決定がこれまでの判断とどう整合するか

- **ADR-0004(統治原則)**: `use=`はソースが要求した範囲だけを実行する。
  既存の関数返り値は update のまま、object の `destroy` が明示された場合だけ
  unmount cleanup を生成する。未要求の汎用 lifecycle runtime は追加しない。
- **ADR-0005(factoryイディオム・teardown不要)**: unit 内のDOM-only listenerは
  従来どおり subtree とともに到達不能にする。一方、component top-level action が
  外部 resource を明示的に登録した場合は、ADR-0022 の `destroy` がその責務を担う。
- **ADR-0008(識別子参照・ゾーン構造)**: `use=`の配線ルール(動きゾーンの
  function宣言への識別子参照、inline arrow許容)はハンドラ属性の規約を
  そのまま転用する。新しいゾーンは追加しない。
- **ADR-0009(本体解析)**: action本体の解析はADR-0009のハンドラ本体解析
  (文種検証・signal読み書きの書き換え)をそのまま適用し、ネストした
  関数への再帰適用のみを新規追加する。解析層を二重に設計しない。
- **ADR-0010(`<Escape mount>`)**: `use=`と`<Escape mount>`は同じ配線
  (識別子参照+要素を引数に受ける関数)の2変種で、区別は1軸
  (本体をコンパイラが解析するか)。`use=`は解析される、`<Escape>`は
  不透明。この役割分担は両ADRに明記する。

## 未決定事項(後続で詰める)

- **reactive params**: paramsの変化でactionを再実行する機構。Svelte 4の
  `update()`前例はあるが、実需が出るまで作らない(ADR-0004)。
- **複数要素action・要素間相互作用の一般解**: 実例がフィクスチャに
  現れるまで先送り(決定6のトリガー条件参照)。
- **第4チャネル(牙抜きref)**: 決定6の「(c)カウンタイディオムが頻出する
  実例」がトリガー条件。
- **unit 内action lifecycle**: `.map()` item / conditional branch の `use=` と
  action registry は、代表的な実需が出るまで scope limit のままにする。
- **CONCEPT.v2.mdへの3原則・仮説(「書きづらいものは設計が間違っている」
  の極限定理)の昇格の要否**: ユーザー判断待ち。

## 実装への引き継ぎメモ

本ADRの設計決定は change `use-action-impl` で実装済み(下記3箇所)。
JSX型定義(`JSX.IntrinsicElements`の`use`宣言)は同changeのdesign.md
Decision 6で明示的にスコープ外とし、別changeへ先送りした
(authored `.jsx`の型検査基盤自体が未整備のため)。この先送りは change
`jsx-type-checking-foundation`(2026-07-21)で解消済み ―
`types/jsx.d.ts`の`JSX.IntrinsicElements`共通属性に`use`を型付けした。

- `src/compiler/render.ts`: `use`属性の解析・識別子参照ルールの解決
  (ADR-0008のハンドラ配線ルールの転用)。トップレベル要素のみ受理し、
  リストアイテム/条件分岐ブランチ内は scope limit で拒否(design.md
  Decision 3)。
- `src/compiler/analyze.ts`: action本体のネストした関数への再帰書き換え、
  関数返り値または`{ update?, destroy? }`返り値の解析。
- `src/codegen.ts`: mount/hydrate時の`use`関数呼び出し・update初期実行・依存
  配線、instance `unmount()`のlistener除去・DOM/structural state解放・destroy逆順実行。
- `packages/runtime/src/index.ts`: action返り値の runtime shape 検証。
