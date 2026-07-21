#!/usr/bin/env bun
// .jsx を1つ受け取り、ブラウザにそのまま出せる dist/index.html + dist/app.js
// を書き出すビルドスクリプト(plans/002-browser-build-target.md)。
// CONCEPT.v2.md「ブラウザに届くのは、静的 HTML と専用の更新コードだけで
// あるべき」を検証するスパイク:初期 HTML は index.html に焼き込み、
// app.js はそれを hydrate するだけ(innerHTML は書かない)。

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compile } from '../src/compiler.js';

const input = process.argv[2];
if (!input) {
  console.error('usage: bun scripts/build.mjs <entry.jsx>');
  process.exit(1);
}

const source = readFileSync(input, 'utf8');
const { code, initialHtml } = compile(source);

// codegen が出す import はテスト用の相対パス '../src/runtime.js' 固定
// (src/codegen.js:13)。test/helpers.js と同じやり方で絶対パスに書き換える。
const runtimePath = JSON.stringify(path.join(process.cwd(), 'src/runtime.js'));
const tmpDir = mkdtempSync(path.join(tmpdir(), 'irisout-'));
const modulePath = path.join(tmpDir, 'module.mjs');
const entryPath = path.join(tmpDir, 'entry.mjs');

writeFileSync(modulePath, code.replace("'../src/runtime.js'", runtimePath));
// エントリは hydrateComponent を呼ぶだけ - mountComponent 側 (innerHTML +
// __INITIAL_HTML__) は import すらしないので、バンドラが tree-shake できる。
writeFileSync(
  entryPath,
  `import { hydrateComponent } from './module.mjs';\nhydrateComponent(document.getElementById('app'));\n`
);

const outdir = path.join(process.cwd(), 'dist');
const result = await Bun.build({
  entrypoints: [entryPath],
  outdir,
  naming: 'app.js',
  format: 'esm',
  target: 'browser',
  minify: false,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

mkdirSync(outdir, { recursive: true });
const indexPath = path.join(outdir, 'index.html');
writeFileSync(
  indexPath,
  `<!doctype html>
<html>
<head><meta charset="utf-8"><title>irisout app</title></head>
<body>
<div id="app">${initialHtml}</div>
<script type="module" src="./app.js"></script>
</body>
</html>
`
);

for (const file of [indexPath, path.join(outdir, 'app.js')]) {
  console.log(`${path.relative(process.cwd(), file)} (${statSync(file).size} bytes)`);
}
