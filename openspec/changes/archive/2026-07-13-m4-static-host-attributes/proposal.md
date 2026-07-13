## Why

現在のコンパイラは `on[A-Z]...` ハンドラ属性以外の全ての JSX ホスト要素属性
(`class`, `id`, `type`, `disabled` など)を scope limit として拒否している
(`src/compiler/render.ts` の `collectHandlerAttrs`)。そのため静的な見た目の
指定すら authored code に書けず、実用的な UI コンポーネントが書けない。
`ROADMAP.md` の「次のアクション」で M4(静的 host 属性)は依存なし・小規模と
され、M4 → ADR-0008(ゾーン API)→ M5 の実装順序で最初に着手すべき項目として
決定済み。

## What Changes

- JSX ホスト要素の**静的**属性(コンパイル時に値が確定するもの)をサポート
  する:
  - 文字列リテラル値(`class="foo"`, `id="bar"` など)
  - 値なしの真偽属性(`disabled`, `checked` のような valueless attribute)
- 属性名は JSX 慣習(`className` ではなく `class` 表記を前提とする、
  `CONCEPT.v2.md`/既存 fixture の書き方に合わせる)をそのまま DOM 属性名として
  使う。属性名の別名対応(`className→class` 変換など)は既存 fixture に
  用例がなければスコープ外として明示的に拒否する。
- **属性値が `JSXExpressionContainer`(`{...}`)のものは全て M4 のスコープ外**
  とし、中身が signal 依存かどうかを問わず compile error で拒否する
  (例 `class={active ? 'a' : 'b'}` だけでなく `tabIndex={0}` のような
  「値は定数だが構文が式コンテナ」なケースも含む)。定数式かどうかの判定は
  依存解析と同じ解析コストを要求するため、`analyze.ts` を介さない構文だけの
  判定に留める ― これが M4 を小さく保つ境界線。reactive host attributes は
  `STATUS.md` に記録済みの post-M6 パリティ穴として、引き続き明確な
  compile error で拒否する(黙って落とさない、ADR-0004/既存規約)。
- `JSXSpreadAttribute`(`{...props}`)は引き続き拒否する(props/子コンポーネント
  インライン化は別課題、`plans/README.md` 記載の post-M6 パリティ穴)。
- 静的属性は初期 HTML テンプレート文字列にそのまま埋め込む。反応性の配線
  (`__markers__`、`update_*`)は不要 ― マーカー発行の対象にしない。

## Capabilities

### New Capabilities

- `static-host-attributes`: JSX ホスト要素に書かれた静的な文字列属性・真偽
  属性をコンパイルし、生成される初期 HTML テンプレートへ反映する。動的な
  属性値・spread 属性は明示的な compile error で拒否する。

### Modified Capabilities

(なし ― 既存の公開仕様に振る舞い変更はない。ハンドラ属性の扱いは変更しない)

## Impact

- `src/compiler/render.ts`: `collectHandlerAttrs` 周辺の属性走査ロジック。
  ハンドラ属性(`on[A-Z]...`)と静的属性を振り分け、後者をテンプレート
  HTML の組み立てに渡す。
- `src/codegen.ts` / `src/template.ts`: 初期 HTML テンプレートへの属性文字列
  の埋め込み(属性値のエスケープを含む)。
- `test/`: 静的属性を含むコンポーネントのコンパイル・生成 HTML を検証する
  テストを追加。
- `examples/`: `examples/counter.jsx` は `<button type='button'>` を含む
  ため、**現状のコンパイラでは compile error になり通らない**
  (`compile: host element attributes are not supported yet (scope limit)`)。
  この変更後は通るようになるべき ― M4 の具体的な受け入れ基準の1つとする。
  `examples/todomvc.jsx` の `class='todoapp'` 等の静的 class もこの変更で
  通るようになる。ただし todomvc の `UNRESOLVED(02)`/`(03)`(動的 class・
  checkbox の `checked` プロパティ)は動的属性なのでこの変更では解決しない
  (M4 は静的属性のみが対象、動的属性は別途 post-M6 パリティ穴として扱う)。
