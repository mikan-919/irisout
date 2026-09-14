# dynamic-disabled-property

## Why

yt-utilのドッグフーディングで、`disabled={busy()}`が`disabled="false"`として
出力され、接続画面のボタンが常に無効になる不具合を確認した。HTMLの真偽属性は
値ではなく属性の存在で有効になるため、動的な`disabled`はDOMプロパティへ反映する
必要がある。

## What Changes

- `disabled`をADR-0012のbooleanプロパティ表へ追加する。
- 初期値と更新値を`element.disabled = value`で反映する。
- falseのときに`disabled`属性をDOMから外す動作を実DOMで検証する。
