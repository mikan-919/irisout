# ADR-0008: authoring APIをゾーン構造(変数→UI→動き)に変更する

## ステータス

決定済み(設計方針。実装は未着手 ― M4/M5との順序づけはROADMAP参照)

## コンテキスト

2026-07-05のgrillingで、authoring APIに対する2つの不満が出た:

1. **リアクティブな記述(イベントハンドラ等)をまとめたい**。現行のinline
   arrow限定(`src/compiler/render.ts`のscope limit)ではJSXのあちこちに
   動きが散らばる。
2. **暗黙書き込みが気持ち悪い**。Reactの`ref`のように「宣言した箱に
   フレームワークが裏から値を入れる」構造を authored code に持ち込みたくない
   (`__markers__`のcodegen内部の同種の問題はSTATUS.md参照 ― 別件として分離)。

望ましい読み順は **変数宣言→UI宣言→動き宣言**。これを満たす案を4つ検討した:

| 案 | 二重記述 | エディタ型 | 合法TS |
|---|---|---|---|
| (a) `render()`がハンドルを返す + JSX内で識別子参照 | なし | ― | ✗ TDZ(TS2448) |
| (b) 同上 + JSX内で文字列参照 | なし | ✗ | ✓ |
| (c) `handler()`事前宣言 + 後から注入 | あり | ✓ | ✓ |
| (d) function宣言の巻き上げ | なし | ✓ | ✓ |

(b)が落ちる理由: TSはJSX式の型を一律`JSX.Element`に潰すため、属性内の
文字列から`render()`の戻り値キーを推論する経路が存在しない
(microsoft/TypeScript#21699、2018年から未解決)。エディタでのキー検査・
rename・go-to-defが原理的に不可能で、この弱点はコンパイラ側では直せない。

(c)が落ちる理由: 事前宣言の行そのものが型の錨なので、二重記述は消せない。

(d)の弱点は2つとも直せる: 「手前に置けてしまう」はコンパイラの配置強制
(scope limit)で禁止でき、「関数宣言しか使えない」は動きゾーンに置くものが
全部関数(ハンドラ、hooksのコールバック)なので実害がない。
**コンパイラで直せない弱点を持たないのは(d)だけ**。

## 決定

コンポーネントは以下の3ゾーン構造で書く。各ゾーンは構文で見分けられ、
配置違反はcompile errorで拒否する:

```jsx
function Component() {
  // ── 変数ゾーン: const(signal/derived含む)のみ ──
  const state = signal(0)
  const doubled = derived(() => state() * 2)

  // ── UIゾーン: render文。returnではない ──
  render(
    <div>
      <button onClick={handleCountDown}>-</button>
      <button onClick={handleCountUp}>+</button>
      <span>{state()}</span>
      <span>{doubled()}</span>
    </div>
  )

  // ── 動きゾーン: function宣言とhooksのみ ──
  function handleCountUp() { state(state() + 1) }
  function handleCountDown() { state(state() - 1) }
  onMount(() => { /* ... */ })
}
```

- ハンドラはJSX内で**識別子参照**(`onClick={handleCountUp}`)、実体は
  `render()`文より**後ろ**のfunction宣言。JSの巻き上げにより合法TSで、
  型・rename・go-to-defが完全に効く。
- **inline arrow(`onClick={() => ...}`)も併存を許す**。配置規則の本質は
  「動きはUI宣言より前に現れてはならない」であり、UIゾーンの中は「UI以降」
  なのでinlineはルール違反ではない(2026-07-05 grillingで決定)。逆に、
  変数ゾーンに`const handleFoo = () => ...`と書いてJSXから参照する形は
  「UIより前の動き」なので不可 ― 識別子参照の解決先は`render()`より後ろの
  function宣言に限る。
- `render()`は値を返さない「ここがUI宣言」というマーカー。`signal()`と同じ
  ビルド時に消える宣言イディオム(ADR-0006)。
- **コンポーネントはJSXをreturnしない**。現行`compileComponent`の
  「単一の`return <JSXElement>`」前提(`src/compiler/render.ts:305-328`)を
  覆す変更。
- 配置規則(変数ゾーンはrenderより前、function宣言・hooksはrenderより後)は
  コンパイラのscope limitとして強制する。違反は静かに通さずcompile error
  (ADR-0007と同じ「安全に拒否」)。

### 受け入れた代償

- authored codeが「JSの巻き上げで名前解決が合法になっている」ことに意味論的に
  依存する。irisoutではauthored codeは実行されない仕様書であり、実行順の
  問題は存在しないが、美観上の抵抗は残る(2026-07-05 grillingで計量の上、
  受け入れ)。

## この決定がこれまでの判断とどう整合するか

- ADR-0004: authored codeは仕様、コンパイラが形を強制する ― scope limitの
  追加はこの原則の適用。
- ADR-0006: `render()`は`signal()`/`derived()`と同列の「ビルド時に消える
  宣言マーカー」。
- ADR-0002/現行scope limit: 「handlerはinline arrowのみ」という制限は
  この決定で緩和される(inline arrowは引き続き許容、識別子参照+巻き上げ
  function宣言が追加)。

## 未決定事項(後続で詰める)

- **ref**(`ref={...}`)の設計、特に条件分岐(`&&`)配下で要素が存在しない
  ときのハンドルの挙動。条件分岐レンダリング自体がM5未実装のため、
  **M5の設計が形になってから**別途判断する。

(実装順序は M4 → 本ADR → M5 で決定済み、ROADMAP参照)
