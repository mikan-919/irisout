import { describe, it, expect } from 'vitest';
import { compile } from '../src/compiler.js';
import { createContainer, loadGenerated } from './helpers.js';

// docs/adr/0001-first-milestone.md の先送り項目その2:コンポーネント境界の
// インライン化。これが直した核心のバグ:declId は以前ソース位置だけから
// 導出されていた(`decl_${declarator.start}`)ため、*同じ*コンポーネントの
// 2つのインスタンスが同じ declId で衝突していた。今はインスタンスごとに
// hygienic な出力名(`n`、`n$1`、…)が振られ、それらへの参照は - prop 境界を
// 跨いでいても - すべて一致するよう書き換えられる。
const TWO_INDEPENDENT_INSTANCES = `
function Row() {
  const n = prop('n');
  return <li>{n() * 2}</li>;
}

function List() {
  return <ul><Row n={1} /><Row n={2} /></ul>;
}
`;

// *同じ*親 signal をエイリアスする2つのインスタンスは、その signal の
// 唯一の専用 update 関数によって両方とも更新されなければならない。
const SHARED_ALIAS_ACROSS_INSTANCES = `
function Row() {
  const shared = prop('shared');
  return <li>{shared()}</li>;
}
function List() {
  const count = signal(0);
  return <ul><Row shared={count()} /><Row shared={count()} /></ul>;
}
`;

describe('component boundary inlining: multiple instances', () => {
  it('gives each instance of the same component its own hygienic signal name, with no collision', async () => {
    const { code, initialHtml } = compile(TWO_INDEPENDENT_INSTANCES);
    expect(initialHtml).toBe('<ul><li data-iris-id="m0">2</li><li data-iris-id="m1">4</li></ul>');

    const mod = await loadGenerated(code);
    expect(mod.n).toBeTypeOf('function');
    expect(mod.n$1).toBeTypeOf('function');
    expect(mod.n()).toBe(1);
    expect(mod.n$1()).toBe(2);

    const container = createContainer();
    mod.mountComponent(container);
    mod.n(10);
    mod.update_n();
    expect(container.querySelector('[data-iris-id="m0"]').textContent).toBe('20');
    // もう一方のインスタンスは手つかず - 焼き込まれた初期値を表示したまま
    expect(container.querySelector('[data-iris-id="m1"]').textContent).toBe('4');
  });

  it('one signal aliased into two instances gets one update_* that touches both markers', async () => {
    const { signalToMarkers, declName } = compile(SHARED_ALIAS_ACROSS_INSTANCES);
    const names = [...signalToMarkers.keys()].map((id) => declName.get(id));
    expect(names).toEqual(['count']);
    expect([...signalToMarkers.values()][0]).toEqual(new Set(['m0', 'm1']));

    const { code } = compile(SHARED_ALIAS_ACROSS_INSTANCES);
    const mod = await loadGenerated(code);
    const container = createContainer();
    mod.mountComponent(container);

    mod.count(7);
    mod.update_count();
    expect(container.querySelector('[data-iris-id="m0"]').textContent).toBe('7');
    expect(container.querySelector('[data-iris-id="m1"]').textContent).toBe('7');
  });
});
