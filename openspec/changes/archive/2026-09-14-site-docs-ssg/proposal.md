## Why

公式文書を直接URLとJavaScriptなしで読める静的HTMLとして公開し、既存の導入文書と公式例を一つの入力から維持する。現在の`app/web`は動作確認画面だけを生成しており、文書一覧、参照検査、検索索引がない。

## What Changes

- Markdown正本から文書一覧・詳細・目次・前後リンクを生成する。
- 8分類とCounter・List・SVGの例を対象版`irisout@0.2.2`で検査する。
- `docs/getting-started.md`を正本として参照し、本文をJSXへ複製しない。
- slug、見出しID、内部リンク、例識別子、任意HTMLをビルド時に検査する。
- JavaScriptなしの直接URLとビルド時検索索引を提供する。

## Capabilities

### New Capabilities

- `site-document-ssg`: Markdown正本から静的文書と検索索引を生成する契約

### Modified Capabilities

なし。

## Impact

`app/web`の生成処理、文書入力、公式例、サイト検査、CIに影響する。文書閲覧物へPlaygroundコンパイラを含めない依存分離を追加する。
