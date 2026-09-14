## Context

`app/web`は一つのauthored JSXを`irisout/vite`で構築する。サイト本文はIrisoutの更新対象DOMの外へ置き、Markdownをビルド時にHTMLへ変換する。導入手順は`docs/getting-started.md`を正本とし、サイト専用のコピーを持たない。

## Goals / Non-Goals

**Goals:**

- 文書の入力検査とHTML出力を`app/web/scripts`へ置く。
- JavaScriptなしの文書閲覧、直接URL、参照切れ検出、検索索引を成立させる。
- 公式例の表示用コードとPlayground入力を同じファイルから生成する。

**Non-Goals:**

- 要求ごとの文書SSR、多言語化、全文検索サービス。
- Markdown内の任意HTML、MDX、スクリプト実行。
- 文書ページでのコンパイラ読込み。

## Decisions

- メタデータ検査、Markdown解析、強調表示、リンク検査、HTML出力をビルド時に実行する。
- slugは一階層に制限し、見出しID生成とリンク検査で同じ関数を使う。
- `docs/getting-started.md`は移動せず、入力として直接参照する。新規文書の配置は計画の`app/web/content/docs`を使う。
- 公式例は一覧の識別子から解決し、任意のファイルパスを受け付けない。

## Risks / Trade-offs

- [Markdown解析器が任意HTMLを通す] → HTMLノードを拒否する検査を追加する。
- [見出しIDとリンク先がずれる] → 生成と検査で同じID生成処理を使う。
- [例と本文の版がずれる] → サイト設定の版と例の検査版を比較する。

## Migration Plan

文書入力を追加し、ビルド生成物を確認してから既存トップへリンクする。失敗時はサイト生成物を公開せず、既存の`app/web`入口を維持する。
