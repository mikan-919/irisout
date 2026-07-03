import { JSDOM } from 'jsdom';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// A real DOM (via jsdom) rather than a hand-rolled fake: once conditional
// rendering needs comment-node anchors, insertAdjacentHTML-style insertion,
// and nextSibling bookkeeping, faithfully reproducing that by hand would
// mean reimplementing an HTML parser.
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
