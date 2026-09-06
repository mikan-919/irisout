## Why

authored `.jsx`の型検査はコンポーネントごとのプロパティ形状を検査せず、イベント引数も
要素・イベント種別へ絞り込まれない。複数ファイル合成を導入した現在、名前間違いと
イベントオブジェクトの誤用をコンパイル前に検出する必要がある。

## What Changes

- JSDocで宣言したコンポーネントのプロパティ形状を、同一ファイルと相対importの
  呼び出し箇所でTypeScriptが検査できる契約と検証用入力を追加する。
- `click`、`dblclick`、`keydown`、`input`、`change`、`blur`のイベント引数をDOMの
  イベント型へ対応付け、`currentTarget`をハンドラを持つ要素型へ絞る。
- 任意の`onXxx`属性を受理する既存契約と、コンパイラの対応範囲制限を型検査とは
  分離する契約を維持する。
- TodoMVCと複数ファイル例へJSDocの公開形を追加し、型検査を実例へ適用する。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `authored-jsx-type-checking`: コンポーネントのプロパティ形状と、要素別イベント引数の
  静的型検査を追加する。

## Impact

- `types/jsx.d.ts`: DOMイベントと要素を結ぶ型、既知イベント属性の型を追加する。
- `apps/examples/**/*.jsx`: コンポーネント境界と識別子参照ハンドラへJSDocを追加する。
- `types/test/**/*.jsx`、`apps/examples/tsconfig.json`: 成功例と失敗例を型検査へ含める。
- コンパイラ、生成コード、実行時APIは変更しない。
