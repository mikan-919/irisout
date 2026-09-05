## Why

`compile(source)`は一つの文字列を受け取り、Program直下の関数宣言だけを
受理する。これにより、別ファイルへ分けたコンポーネント・補助関数・定数を
通常のimportで組み合わせられない。`apps/examples/vite.config.ts`も一つの
ファイルを`readFileSync`して渡すため、入口が複数ファイルになると一般用途の
障害になる。

## What Changes

- `compileProject(entryPath)`を追加し、入口から辿れる相対`.js`/`.jsx` moduleを
  静的に解決する。
- importを依存順にリンクし、コンポーネントは既存のコンパイル時ASTインライン化へ、
  通常の関数・`const`は生成moduleの補助コードへ渡す。
- named importとdefault importを受理し、外部specifier、動的import、循環依存、
  再export、未対応のmodule文は`compile:`エラーで拒否する。
- 既存の`compile(source)`と単一ファイルの出力・テストは維持する。
- examplesのVite pluginを`compileProject`経路へ変更し、3ファイル以上のfixtureと
  実DOM試験を追加する。

## Non-goals

- `node_modules`の解決、パッケージ公開、動的import、循環依存。
- moduleスコープのsignal共有、実行時コンポーネント、仮想DOM。
- TypeScript moduleの変換、children/slot、props spread。
