# 記述境界の文書が要求単位SSRとJSX返却を否定している

観測日: 2026-10-08。利用者試験Aの原文:

> authoring.mdの「Server rendering per request ... are not part of the current contract.」に対し、hono-file-routing.mdは要求単位SSRを案内する。

> api-reference.mdの「部品はJSXを返さず、内部で`render()`を呼ぶ。」に対しcomponents-and-modules.mdはreturn JSXを許可。

## 対応

`skills/irisout/references/authoring.md`で通常のclient buildと`irisout/ssr`・`irisout/hono`を区別し、返却JSX、TypeScript相対モジュール、Motion拡張の説明を現行契約に合わせた。`docs/api-reference.md`で`render()`とJSX返却の両方を記載した。利用者試験Aの共有文書部品はJSXを返し、一覧と詳細の要求ごとのHTML生成、型検査、本番構築を通過した。
