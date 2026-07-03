# ADR-0003: ブラウザ向けビルド出力(静的 index.html + 単一 app.js)

## ステータス

決定済み(検証スパイク。dev サーバー・watch・複数ファイル入力は先送り)

## コンテキスト

CONCEPT.v2.md 9行目は irisout の製品としての約束を「ブラウザに届くのは、
静的 HTML と専用の更新コードだけであるべきです」と定義している。しかし
plans/002 着手時点では、コンパイラの出力はまだ一度もブラウザに届いていない
- 生成モジュールは `import ... from '../src/runtime.js'` を固定で持ち
(`src/codegen.js:13`)、消費者は jsdom テストと `examples/demo.mjs` だけ
だった。さらに既存の `mount()` は `container.innerHTML = html` で初期 HTML
を実行時に書き込んでおり(`src/runtime.js:29-35`)、これは「HTML は静的に
届く」というコンセプトの主張と矛盾する。本 ADR は、1つの `.jsx` を
`dist/index.html`(初期 HTML をドキュメントに焼き込み済み)+ 1つの
`dist/app.js`(それを hydrate するだけ)に変換するビルドスクリプトの
決定を記録する。

## 決定

### 1. hydrate と mount を分ける

`mount()` は「innerHTML を書く」と「マーカー/アンカーを発見する」という
2つの責務を持っていた。この2つはもともと独立した関心事だったので、
`hydrate(container)`(`src/runtime.js`)を新設し、innerHTML への書き込みを
せずマーカー/アンカーの発見だけを行う `mount()` のサブセットとした。
`src/codegen.js` は `mountComponent(container)` に加えて
`hydrateComponent(container)` を emit する。両者の違いは
`markers/anchors` の得方(`mount(container, __INITIAL_HTML__)` か
`hydrate(container)` か)だけで、その後の `__cond_*`/`__list_*` 初期化と
ハンドラ配線(`addEventListener`)は共有の `setupLines` 配列から文字列
レベルで両関数に複製している(`generateModule` 内、コメント参照)。
`mountComponent` は変更していないので、既存の jsdom テスト・
`examples/demo.mjs` は無改造で動く。

ビルド出力では `index.html` の `<div id="app">` の中に `initialHtml` を
直接埋め込み、`app.js` 側は `hydrateComponent` だけを呼ぶ。これにより
初期 HTML は文字通り静的 HTML として届き、JS の中に埋め込まれた文字列
としては(理想的には)届かない。

### 2. バンドル戦略:単一 app.js、ランタイムはインライン化

新しい依存は追加しない。`CLAUDE.md` がバンドラとして `bun` を指定しており、
`Bun.build` がそのまま使える。ビルドスクリプト
(`scripts/build.mjs`)は `compile()` の出力コードを一時ディレクトリに
書き出す際、`test/helpers.js` と同じ手順で `'../src/runtime.js'` の
import を絶対パスに書き換える。エントリファイルは

```js
import { hydrateComponent } from './module.mjs';
hydrateComponent(document.getElementById('app'));
```

の2行だけを持ち、`Bun.build({ format: 'esm', minify: false, target:
'browser' })` でこれをエントリにバンドルする。`minify: false` は
「理想的な出力は人間が手で書いたコードに見えること」という
CONCEPT.v2.md の立場を反映した意図的な選択。

### 3. `__INITIAL_HTML__` の二重出荷は実際には起きなかった

Design decision 1 で懸念していた「`mountComponent` を import しなくても
`__INITIAL_HTML__` が `app.js` に残ってしまう」問題は、実測では発生
しなかった。エントリが `hydrateComponent` だけを import するため、
`Bun.build` は `mountComponent`・`mount`・`__INITIAL_HTML__` 定数・
`insertAfter`・`htmlToNode`・`forgetReactive` をすべて tree-shake で
落とす。`examples/counter.jsx` でのビルド確認:

```
$ bun run build examples/counter.jsx
dist/index.html (296 bytes)
dist/app.js (1636 bytes)
$ grep -c '__INITIAL_HTML__' dist/app.js
0
```

`dist/app.js` の中身は `signal`/`derived`/`hydrate`/`collectReactive`
とコンポーネント固有のコードのみで、`mount` 系は一切現れない。したがって
「codegen をモジュール分割してまで二重出荷を避ける」というメンテナンス
ノートの対応は、現時点では不要と判断する(将来 `Bun.build` の挙動が
変わった場合に再検証すること)。

## スコープ制限(この回で対応しないこと)

- dev サーバー・watch モード・複数ファイル入力・CSS 対応は先送り。
- minify・ファイルハッシュ等の本番向け仕上げは先送り。
- `initialHtml` の HTML エスケープは行っていない(既存仕様どおり生の
  マークアップをそのまま埋め込む)。条件分岐マーカーが持つコメント
  アンカー(`<!--m2-->`)を含む出力でも `</div>` が壊れないことは
  `test/build.test.js` の counter 例(ハンドラのみ、条件分岐なし)では
  確認していない。次にリスト/条件分岐付きの例をビルドする際に確認する
  こと(plans/002 の Maintenance notes 参照)。

## 未決定事項(後続で詰める)

- リスト/条件分岐を持つコンポーネントへのハンドラ対応(Plan 001 で
  先送り)が着地したら、`scripts/build.mjs` での実ブラウザ確認を
  そのケースでも行うこと。
- 本 ADR 作成時点ではサンドボックス環境にブラウザがなく、
  `dist/` を実ブラウザで開いてクリックする手動確認は未実施。jsdom による
  `test/build.test.js` の自動テストで hydrate + ハンドラ配線を代替
  検証した。
