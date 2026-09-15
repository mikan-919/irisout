## Context

Irisoutの記述APIはコンパイル時に解析され、生成moduleへ残らない。依存先を明示するため、公開入口のimportを解析前に除去し、既存の名前ベースのコンパイラ処理へ渡す。

## Goals / Non-Goals

**Goals:**

- `import { signal, derived, render } from 'irisout'`を正規のauthored JSX記法にする。
- 別名を含む名前付きimportを解析し、生成物からimportを除去する。
- 公開入口の型検査と、既存のVite・browser・module linker経路を維持する。

**Non-Goals:**

- signal/derivedをブラウザ実行用の一般ランタイムAPIへ変更すること。
- `irisout/authoring`のような追加公開入口を作ること。
- 既存の生の`compile(source)`入力をこの変更で一括廃止すること。

## Decisions

- 記述APIは`irisout`の名前付きvalue importだけを受理する。
- default import、namespace import、未知の名前は`compile:` scope limitにする。
- 公開入口の関数はコンパイルを通さず実行された場合に例外を投げる。
- `types/jsx.d.ts`はJSX namespaceと要素属性だけを宣言し、記述APIを大域に宣言しない。
- 型検査対象外の既存compile入力は後方互換として残す。

## Risks / Trade-offs

- [入力経路ごとに記法が一時的に異なる] → 正式な利用例と型検査対象は明示importへ移行し、裸の入力を将来廃止する場合は別変更にする。
- [import除去後のsource map行が変わる] → 元sourceの行を期待する試験を更新し、consumer appと梱包検査で確認する。

## Migration Plan

公開例と型検査対象の`.jsx`へ名前付きimportを追加する。既存の文字列入力は互換性のため維持し、将来廃止する場合はPlayground、試験、文書を同時に移行する。
