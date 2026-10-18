# 通常変数の診断

`bun -e 'import { compile } from "irisout"; compile(await Bun.file("repro/ordinary-local.jsx").text())'`

期待: unused変数であることとは別に、描画前の通常const変数の対応範囲が文書から分かること。
実際: `compile: only top-level `signal()`/`derived()` declarations are supported in this milestone (scope limit)`。

この制限が文書に書かれていれば、要求番号と生存状態を初めからsignalとして宣言できた。
