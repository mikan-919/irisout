import { describe, it, expect } from 'vitest';
import { compile } from '../src/compiler.js';
import { createContainer, loadGenerated } from './helpers.js';

// Second deferred item from docs/adr/0001-first-milestone.md: component
// boundary inlining. The core bug this fixes: declId used to be derived from
// source position alone (`decl_${declarator.start}`), so two instances of
// the SAME component collided on the same declId. Instances now get a
// hygienic output name (`n`, `n$1`, ...) and every reference to them - even
// across a prop boundary - is rewritten to match.
const TWO_INDEPENDENT_INSTANCES = `
function Row() {
  const n = prop('n');
  return <li>{n() * 2}</li>;
}

function List() {
  return <ul><Row n={1} /><Row n={2} /></ul>;
}
`;

// Two instances that both alias the SAME parent signal must both be touched
// by that signal's one dedicated update function.
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
    // the other instance is untouched - still showing its baked initial value
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
