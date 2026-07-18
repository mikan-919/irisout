# escape-initial-html

## Why

テキスト式の値がビルド時実行テンプレート(`src/compiler.ts` の
`return \`${rootHtmlSource}\``)へ**HTML エスケープなし**で焼き込まれる。
`signal("<img src=x onerror=alert(1)>")` を含むソースをコンパイルすると
`dist/index.html` に生 HTML が注入される(実証済み)。さらに、実行時更新は
`textContent`(HTML 非解釈)なので、同じ値が初回表示では HTML 解釈・更新後は
テキストという意味の不一致になる。出荷物への注入穴かつハイドレーション整合性の
破れであり、M6(no-wrapper 検証)より先に塞ぐべき。

## What Changes

- ビルド時実行テンプレートに埋め込まれる式値(`sourceRendered` 由来の
  `${...}`)を HTML エスケープ関数で包み、初期 HTML への焼き込みを
  `textContent` と同じ「テキストとしての値」に揃える。
- エスケープはビルド時実行の中でのみ行う — 生成モジュール(出力コード)は
  従来どおり `textContent` を使うため変更しない(ADR-0004: 出力を膨らませない)。
- 既存スナップショット(golden)のうち、影響を受けるのは HTML 特殊文字を含む
  フィクスチャのみ。既存フィクスチャに特殊文字がなければスナップショットは
  不変であること自体が退行検証になる。

## Capabilities

### New Capabilities

- `initial-html-escaping`: ビルド時実行で焼き込まれる初期 HTML のテキスト
  部分が HTML エスケープされ、実行時 `textContent` 更新と同一の表示になる
  こと。

### Modified Capabilities

(なし — 既存 spec はテキスト焼き込みのエスケープ要件を規定していない)

## Impact

- `src/compiler.ts`: ビルド時実行の計装テンプレート組み立て(エスケープ
  ヘルパーの注入)。
- `src/compiler/render.ts` または `src/template.ts`: `sourceRendered` 式を
  エスケープ呼び出しで包む位置(テキストマーカーの sourceInner 組み立て)。
- `test/`: 注入フィクスチャ(`<`/`&` を含む signal 初期値)の追加。
- 生成コード(`src/codegen.ts` の出力)・ランタイムは不変。
