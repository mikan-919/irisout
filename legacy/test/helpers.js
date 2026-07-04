import { JSDOM } from 'jsdom';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 手作りのフェイクではなく(jsdom による)実 DOM を使う:条件レンダリングが
// コメントノードのアンカー、insertAdjacentHTML 的な挿入、nextSibling の
// 帳簿付けを必要とする以上、それを手で忠実に再現するのは HTML パーサーの
// 再実装になってしまう。
export function createContainer() {
  const dom = new JSDOM('<!doctype html><div id="app"></div>');
  return dom.window.document.getElementById('app');
}

export async function loadGenerated(code) {
  const runtimePath = JSON.stringify(path.join(process.cwd(), 'src/runtime.js'));
  const file = path.join(tmpdir(), `irisout-${Date.now()}-${Math.random()}.mjs`);
  writeFileSync(file, code.replace("'../src/runtime.js'", runtimePath));
  return import(file);
}
