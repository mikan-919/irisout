import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { compile } from '../src/compiler.js';
import { loadGenerated } from './helpers.js';

// plans/002-browser-build-target.md: ブラウザに届くのは静的 HTML と
// hydrate 用の app.js だけであるべき、という CONCEPT.v2.md の主張を検証する。
const COUNTER_SOURCE = readFileSync(new URL('../examples/counter.jsx', import.meta.url), 'utf8');

describe('hydrate over statically baked HTML (no mount(), no innerHTML write)', () => {
  it('hydrateComponent discovers markers on pre-existing HTML and handlers still update it', async () => {
    const { code, initialHtml } = compile(COUNTER_SOURCE);

    // mountComponent を一切呼ばず、DOM に直接 initialHtml を焼き込む -
    // これがビルド出力 (dist/index.html) が行うことそのもの。
    const dom = new JSDOM(`<!doctype html><div id="app">${initialHtml}</div>`);
    const container = dom.window.document.getElementById('app');
    expect(container.textContent).toContain('count: 0');

    const mod = await loadGenerated(code);
    mod.hydrateComponent(container);

    const button = container.querySelector('button');
    const Event = dom.window.Event;
    button.dispatchEvent(new Event('click'));

    expect(container.querySelector('p').textContent).toBe('count: 1 / doubled: 2');
  });
});

describe('scripts/build.mjs end to end', () => {
  it('produces dist/index.html with baked HTML and dist/app.js that hydrates', () => {
    const result = spawnSync('bun', ['scripts/build.mjs', 'examples/counter.jsx']);
    expect(result.status).toBe(0);

    const html = readFileSync('dist/index.html', 'utf8');
    expect(html).toContain('count: 0');
    expect(html).toContain('<div id="app">');

    const appJs = readFileSync('dist/app.js', 'utf8');
    expect(appJs).toContain('hydrateComponent');
    expect(appJs).toContain('addEventListener');
  });
});
