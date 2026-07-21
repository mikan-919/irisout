## Context

`src/`のコンパイラは`.jsx`をBabel ASTとして直接解析し(`@babel/parser`)、
`JSX.createElement`のようなランタイム呼び出しには一切変換しない
(`docs/architecture.md`のコンパイルパイプライン参照)。つまり出力コードに
JSXランタイム(`react/jsx-runtime`相当)は存在せず、`.jsx`はコンパイラの
入力形式であって実行時JSXではない。

現状`tsconfig.json`の`include`は`src/**/*.ts`・`test/**/*.ts`・
`scripts/**/*.ts`のみで、`examples/*.jsx`は対象外。これらのファイルを
`tsc --noEmit`(および エディタのTS言語サーバ)の型検査に載せるには
(a) TSに`.jsx`を処理させる設定と(b) `signal`/`derived`/`render`という
未定義グローバル・独自の`JSX`namespaceの型宣言、の両方が要る。

authoring APIが実際に受理する属性名の集合はコンパイラ側で固定リストに
なっていない(M4静的host属性・ADR-0012動的host属性は、`checked`/`value`を
プロパティ反映として特別扱いする以外は任意の属性名を`setAttribute`へ通す)。
型定義を属性名レベルで厳密化すると、コンパイラが受理する正当な属性
(`aria-*`・`data-*`・将来追加されるDOM属性)を型エラーとして誤検出する
リスクがある。

(実装時に判明した追加の制約 ― 当初案からの変更点は Decision 2 参照)
`allowJs`+`checkJs`をルートの`tsconfig.json`へそのまま足すと2つの問題に
当たった: (1) `test/todomvc-handwritten.test.ts`が`import`する
`examples/todomvc.handwritten.js`(型検査対象外の比較用の手書きJS)まで
importグラフ経由で検査対象になり、同ファイル内の`@ts-expect-error`
(旧・tsconfig未対応を理由に型解決エラーを意図的に抑制していたコメント)
が「使われていない`@ts-expect-error`」エラーへ転化する。(2) `types`
compilerOptionを明示しないと`node_modules/@types/react`が自動包含され、
その`declare global JSX`が本プロジェクト独自の`JSX`namespaceを踏んで
`DetailedHTMLProps`等React型のエラーに化ける。

## Goals / Non-Goals

**Goals:**
- `types/jsx.d.ts`でグローバル`JSX`namespace(`Element`・
  `IntrinsicElements`・`ElementChildrenAttribute`)と`signal`/`derived`/
  `render`のグローバル関数シグネチャを宣言する。
- `examples/**/*.jsx`を`tsc --noEmit`の型検査対象に含める
  (実装時の判明事項によりルートの`tsconfig.json`ではなく
  `examples/tsconfig.json`を新設する形に変更。Decision 2参照)。
- 既存の`examples/counter.jsx`・`examples/todomvc.jsx`が型エラーなく
  `tsc --noEmit`を通ることを確認する。
- ADR-0011が先送りしていた`use`属性のJSX型を今回で埋める
  (`JSX.IntrinsicElements`共通部に追加)。

**Non-Goals:**
- 属性名・属性値をタグごとに完全に`lib.dom.d.ts`準拠で縛ること
  (上記Contextの理由により、意図的に緩くする)。
- コンポーネントprops(ADR-0014のshorthand分割代入)の厳密な型推論・
  ジェネリクス化。
- コンパイラのscope limit判定を型で代替すること(型が通っても
  実行時`compile:`エラーになるケースは残る。例: リストアイテム内の
  `use=`は型上は書けるが実行時はscope limit ― STATUS.md既知の制約)。
- `.tsx`拡張子への移行(authored formatは引き続き`.jsx`のまま)。

## Decisions

### Decision 1: `compilerOptions.jsx`は`"preserve"`

`react-jsx`/`react-jsxdev`は`jsxImportSource`が指すモジュールから
`jsx`/`jsxs`/`Fragment`のexportを要求する(実在しないランタイム
モジュールをでっち上げることになり、ADR-0004の「ソースが要求した以上を
実行しない」原則にコード面でも反する)。`"preserve"`はJSX構文をそのまま
残し、TSの型検査は独自のグローバル`JSX`namespace
(`declare global { namespace JSX { ... } }`)だけで完結する
(TS公式の「JSXなしのカスタムJSX」パターン)。`tsc --noEmit`しか使わない
(コード生成はビルドに使わない)ため、`preserve`の出力自体は無関係。

代替案: `react-jsx`(却下 ― 存在しないランタイムモジュールが要る)。

### Decision 2: `.jsx`は`allowJs`+`checkJs`で拾う。ただしルート
`tsconfig.json`ではなく`examples/tsconfig.json`という別プロジェクトで

`.tsx`にリネームすればTS本来の型検査対象になるが、authored formatを
`.jsx`のままにするというCONCEPT.v2.mdの前提(手書きJSに近い最小限の
コンパイラ入力)を変えたくない。`allowJs: true` + `checkJs: true`で
`.jsx`ファイルもTSの通常の型検査パスに乗せる。

当初案(proposal起票時点)はこれをルートの`tsconfig.json`に直接追加する
想定だったが、実装時に2つの問題が判明し撤回した(Context参照):

1. `allowJs`/`checkJs`はプロジェクト単位のオン/オフしかなく、
   include対象のファイルだけに限定する仕組みが無い。importグラフで
   到達可能な`.js`ファイル(`examples/todomvc.handwritten.js`)も
   巻き込まれ、既存の`test/todomvc-handwritten.test.ts`の
   `@ts-expect-error`を壊す。
2. `types`を明示しないプロジェクトは`node_modules/@types/*`を自動で
   全部拾う。`@types/react`が`declare global JSX`で割り込み、
   本プロジェクト独自の`IntrinsicElements`定義を覆い隠す。

対策として、ルートの`tsconfig.json`は完全に無変更のまま、
`examples/tsconfig.json`という独立したプロジェクト(`extends`なし)を
新設した:

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "jsx": "preserve",
    "types": [],
    "strict": false,
    ...
  },
  "include": ["**/*.jsx", "../types/jsx.d.ts"]
}
```

`types: []`で`@types/*`の自動包含を止める(問題2の対策)。`include`を
`examples/`配下の`.jsx`と`types/jsx.d.ts`のみに絞ることで、
`test/`配下のファイルはこのプロジェクトに一切含まれず、
`.handwritten.js`への到達経路そのものが無い(問題1の対策 ―
`todomvc.jsx`は`.handwritten.js`をimportしていない)。

`strict: false`はNon-Goalsの帰結: authored `.jsx`は型注釈を書けない
素のJS構文なので、`strict`(実質`noImplicitAny`)を掛けるとハンドラ引数
(`function onCommitEdit(e) {...}`のような識別子参照ハンドラの仮引数、
ADR-0009)のほぼ全てが implicit any でエラーになり実用にならない。
タグ名の存在チェック・`signal`/`derived`の型・JSX属性の形(`onXxx`/
`use`)は`strict`なしでも効く(実装後に手動確認済み)。

`package.json`の`typecheck`スクリプトは2つの`tsc --noEmit`呼び出し
(ルート・`examples/tsconfig.json`)を`&&`で連結する。

代替案:
- `.tsx`へ拡張子変更(却下 ― authored formatの変更はROADMAP次の
  アクション10のスコープ外、CONCEPT.v2.mdの見直しが要る)。
- ルートtsconfigに`allowJs`/`checkJs`を追加し、`exclude`で
  `.handwritten.js`を除外(却下 ― `exclude`はrootファイル集合からの
  除外であって、importグラフ経由の到達を防がない。TSの既知の挙動)。

### Decision 3: `JSX.IntrinsicElements`は「タグ名は厳密・属性名は緩い」

タグ名は`HTMLElementTagNameMap`の`keyof`で列挙する(存在しないタグ名の
typoは拒否できる)。属性は共通部(`use`・`onXxx`ハンドラ・`children`)のみ
明示的に型付けし、それ以外は`[attr: string]: unknown`の緩いindex
signatureで受ける(`key`は同一ファイル内合成コンポーネント・intrinsic
要素の両方に無条件で乗るため、`IntrinsicElements`側ではなく
`JSX.IntrinsicAttributes`側で宣言する。Decision 6参照)。Goals/Non-Goalsの
通り、コンパイラが属性名をホワイトリスト化していない以上、型を先に
狭めると正当な属性が誤検出されるため。将来、属性名レベルの厳密化が
要る場合は実需(具体的な誤用の実例)が出てから別changeで締める。

### Decision 4: `signal`/`derived`/`render`のグローバル関数シグネチャ

`src/runtime.ts`の`signal<T>(initial, declId?)`は`declId`が
コンパイラ注入専用(ADR-0006、authored APIの一部ではない)なので、
`types/jsx.d.ts`側は`declId`を持たない公開シグネチャのみ宣言する:

```ts
declare function signal<T>(initial: T): (...args: [] | [T]) => T
declare function derived<T>(compute: () => T): () => T
declare function render(element: JSX.Element): void
```

読み書き両用の関数型(`()`で読み、`(v)`で書き)は`runtime.ts`の
ビルド時実装の返り値型と一致させ、型と実装が別々にドリフトしないように
そのまま転記する。

### Decision 5: `use`属性の型(ADR-0011 Decision 6の解消)

`use`はmount時に1回呼ばれ、返り値があれば「更新のたびに呼ばれる
再描画クロージャ」として配線される(`src/codegen.ts`のaction配線)。
型は次の通り(`El`は`IntrinsicElements`のマップ型経由でタグごとの
`HTMLElementTagNameMap[K]`が渡る):

```ts
type IrisUseAction<El extends Element> = (el: El) => void | (() => void)
// IntrinsicElements[K] = IrisCommonAttributes<HTMLElementTagNameMap[K]>
// なので <input use={fn}> の fn は (el: HTMLInputElement) => ... に絞られる
```

STATUS.md既知の制約(リストアイテム/条件分岐ブランチ内の`use=`は
scope limit)は型では表現しない ― Non-Goalsの通り、型はscope limit
判定の代替にならない。この非対称性(top-level要素では型も実行時も
書けるが、ユニット内では型上は書けるのに実行時はcompile error)は
design.md上に明記し、実装者がscope limitを型で塞げると誤解しないよう
コメントを残す。

### Decision 6: `JSX.Element`は`void | object`、`key`は`IntrinsicAttributes`経由

実装時、`examples/todomvc.jsx`の`<TodoItem key={todo.id} todo={todo}
.../>`(同一ファイル内合成、ADR-0014)が型エラーになる問題が判明した:

1. `TodoItem`は`render()`を内部で呼ぶだけで値を返さない関数
   (推論される返り値型は`void`)。TSのJSXコンポーネントチェックは
   「タグの返り値がJSX.Elementに代入可能か」を見るため、`Element`が
   空interface(値を返さないと代入不可)のままだと`'TodoItem' cannot be
   used as a JSX component`になる。対策: `type Element = void | object`
   (`undefined`への機械的な置き換えは不可 ― 返り値なし関数の推論型は
   `void`であって`undefined`ではないため、置き換えると同じエラーが
   復活する。biome `noConfusingVoidType`は`biome-ignore`で抑制)。
2. `key`はintrinsic要素側の`IrisCommonAttributes`にしか無く、
   コンポーネント(`TodoItem`)は自前のprops型
   (`{ todo, onToggle, onCommitEdit, onRemove }`)だけを見るため
   `key`が無いプロパティとして型エラーになる。対策: Reactと同じ
   `JSX.IntrinsicAttributes`パターンで`key?: string | number`を
   グローバルに宣言する ― intrinsic要素・コンポーネントを問わず
   全てのJSXタグに無条件で乗る特別枠として扱う。

この2点は「同一ファイル内合成コンポーネント(ADR-0014)は通常のJSX
function componentのcontractと形が違う(値を返さず、render()を副作用
として呼ぶ)」という、proposal起票時には具体化していなかった相互作用
であり、実装中の型エラーから発見した。

## Risks / Trade-offs

- [属性名が緩いままなので、typo(`onCliick`のような`on`始まりの
  誤字)は`on${string}`パターンにマッチする限り型エラーにならない]
  → 許容する。属性名ホワイトリスト化はGoals外(Decision 3参照)。
  将来実需が出たら別changeで締める。
- [`use=`の型が通ってもユニット内では実行時scope limitになる非対称性]
  → design.md本文とコード側のコメント(ADR番号付き)で明記し、
  誤解を防ぐ(コーディング規約通り「なぜそうなっているか」を書く)。
- [`examples/tsconfig.json`の`include`は`**/*.jsx`なので、将来
  `examples/`配下に別の`.jsx`(型検査を意図しないもの)が増えると
  自動的に検査対象になる]
  → 現状`examples/`の`.jsx`は`counter.jsx`・`todomvc.jsx`の2つのみで
  どちらも検査対象として妥当。増えた場合は都度判断する(意図した挙動)。
- [`strict: false`(Decision 2)により、型注釈を書けるTS側の`src/`と
  違って`examples/`側は実引数の型ミスマッチ以外の一部のバグ
  (例: 存在しないプロパティへのアクセス)を見逃す]
  → Non-Goalsの通り許容する。将来examplesを厳格化したくなったら
  JSDoc型注釈の追加を別途検討する。

## Migration Plan

- 追加のみの変更(新規`types/jsx.d.ts`・`examples/tsconfig.json`、
  `package.json`の`typecheck`スクリプト更新)。ルートの`tsconfig.json`・
  既存の`src/`実装・生成コード・テストは無変更。
- ロールバック: `types/jsx.d.ts`・`examples/tsconfig.json`を削除し
  `package.json`の`typecheck`スクリプトをrevertするだけで完全に
  無効化できる。

## Open Questions

- なし(スコープはROADMAP次のアクション10の記述通りに閉じている)。
