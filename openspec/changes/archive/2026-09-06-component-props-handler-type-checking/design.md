## Context

`apps/examples/tsconfig.json`は`.jsx`を`allowJs`と`checkJs`で検査するが、
`strict: false`のため型宣言のない分割代入引数と関数宣言の仮引数は`any`になる。
`types/jsx.d.ts`は全`onXxx`属性を`(event: Event) => void`としており、イベント名と
要素名の情報を使っていない。コンパイラはJSXを直接解析するため、型情報を生成コードへ
渡す必要はない。

## Goals / Non-Goals

**Goals:**

- `.jsx`のままコンポーネント境界を宣言し、同一ファイルと相対importで検査する。
- 実ブラウザで検証済みの6イベントをDOMイベント型へ対応付ける。
- イベント処理関数が登録された要素を`currentTarget`の型へ反映する。

**Non-Goals:**

- コンポーネントのプロパティ型を実装から自動生成すること。
- DOMの全イベント名と全属性値を列挙すること。
- `event.target`を属性が書かれた要素型へ変更すること。
- コンパイラの対応範囲制限をTypeScriptで再現すること。

## Decisions

### 1. コンポーネント境界はJSDocで宣言する

コンポーネントの分割代入引数へ`@param`、必要な値形へ`@typedef`を記述する。
TypeScriptは`.jsx`と相対importの両方でこの宣言を読み、呼び出し箇所の必須項目、
余分な項目、値型を検査する。コメントなのでBabelの解析、コンパイル時インライン化、
生成コードへ影響しない。

代案の`.tsx`化は入力形式を変えるため採用しない。コンパイラによる型定義生成は、
TypeScriptと同じ型推論器が必要になり、この変更の範囲を超えるため採用しない。

### 2. 既知の6イベントだけを個別型へ対応付ける

`click`、`dblclick`、`keydown`、`input`、`change`、`blur`は既存の実ブラウザ検証で
意味を確認している。各`onXxx`属性を`MouseEvent`、`KeyboardEvent`、`InputEvent`、
`Event`、`FocusEvent`へ対応付ける。その他の`onXxx`は関数であることだけを検査し、
イベント型の絞り込みは保証しない。

DOMのイベント名全体から属性名を機械生成する案は、`dblclick`から`onDblClick`のような
単語境界を復元できず、コンパイラが任意の`onXxx`を受理する契約とも一致しないため採用しない。

### 3. `currentTarget`だけを要素型へ絞る

生成コードは属性が書かれた要素へ`addEventListener`で直接登録するため、処理中の
`currentTarget`はその要素である。一方、`target`は子要素から伝播したイベントでは
子要素を指す。`target`までホスト要素に絞ると実行時と型が食い違うため、DOM標準型を維持する。

### 4. 負の型検査例を専用入力へ置く

`types/test/**/*.jsx`をexamples用TypeScript設定へ追加し、意図した型エラーを
`@ts-expect-error`で固定する。注釈が不要になった場合もTypeScriptが未使用注釈として
失敗するため、型定義が緩くなる回帰も検出できる。実行時の例には失敗コードを混ぜない。

## Risks / Trade-offs

- [JSDocを書かないコンポーネントは従来どおり`any`になる] → 例と仕様で公開境界への
  JSDocを規約として示し、暗黙の自動推論を保証しない。
- [6イベント以外の引数型は絞り込まれない] → 実需とブラウザ意味を確認したイベントを
  後続変更で追加する。
- [`currentTarget`は処理関数の実行中だけ有効である] → 型はDOM標準と同じ同期処理中の
  契約とし、非同期処理での保持を保証しない。

## Migration Plan

既存例へJSDocを追加し、`target.value`を使う入力処理は直接登録の意味に合う
`currentTarget.value`へ変更する。ロールバックはJSDoc、イベント型、型検査専用入力を
削除すればよく、コンパイラと生成物の変更はない。
