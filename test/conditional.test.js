import { describe, it, expect } from 'vitest';
import { compile } from '../src/compiler.js';
import { createContainer, loadGenerated } from './helpers.js';

// Third deferred item from docs/adr/0001-first-milestone.md: structural
// updates, scoped down to conditional rendering only (lists are still
// deferred). `visible() && <span>{count()}</span>` mixes both forms this
// milestone supports: an always-present comment anchor drives insert/remove
// of the branch, and the branch's own nested reactive expression proves the
// inserted subtree's markers get discovered and wired up dynamically.
const TOGGLE_WITH_NESTED_REACTIVITY = `
function App() {
  const visible = signal(true);
  const count = signal(1);
  return <div>{visible() && <span>{count()}</span>}</div>;
}
`;

const TERNARY_SOURCE = `
function App() {
  const on = signal(true);
  return <div>{on() ? <span>yes</span> : <em>no</em>}</div>;
}
`;

const MIXED_TEXT_AND_CONDITIONAL = `
function App() {
  const visible = signal(true);
  const count = signal(1);
  return <div>Count: {count()} and {visible() && <span>shown</span>} tail</div>;
}
`;

describe('conditional rendering', () => {
  it('wraps a text/expr run sharing an element with a conditional in its own synthetic marker', async () => {
    const { initialHtml, code } = compile(MIXED_TEXT_AND_CONDITIONAL);
    expect(initialHtml).toBe('<div><span data-iris-id="m0">Count: 1 and </span><!--m1--><span>shown</span> tail</div>');

    const mod = await loadGenerated(code);
    const container = createContainer();
    mod.mountComponent(container);

    mod.count(2);
    mod.update_count();
    expect(container.innerHTML).toBe('<div><span data-iris-id="m0">Count: 2 and </span><!--m1--><span>shown</span> tail</div>');

    mod.visible(false);
    mod.update_visible();
    expect(container.innerHTML).toBe('<div><span data-iris-id="m0">Count: 2 and </span><!--m1--><!----> tail</div>');
  });


  it('bakes whichever branch is true at build time, with the other side as an empty placeholder', () => {
    const { initialHtml } = compile(TOGGLE_WITH_NESTED_REACTIVITY);
    expect(initialHtml).toBe('<div><!--m0--><span data-iris-id="m1">1</span></div>');
  });

  it('removes the branch when the condition goes false, and its nested marker stops being touched', async () => {
    const { code } = compile(TOGGLE_WITH_NESTED_REACTIVITY);
    const mod = await loadGenerated(code);
    const container = createContainer();
    mod.mountComponent(container);

    expect(container.querySelector('span')).not.toBeNull();

    mod.visible(false);
    mod.update_visible();
    expect(container.querySelector('span')).toBeNull();
    expect(container.innerHTML).toBe('<div><!--m0--><!----></div>');

    // the removed branch's own signal no longer has anything to update
    mod.count(99);
    expect(() => mod.update_count()).not.toThrow();
  });

  it('re-inserts the branch when the condition goes back true, wiring up its nested marker fresh', async () => {
    const { code } = compile(TOGGLE_WITH_NESTED_REACTIVITY);
    const mod = await loadGenerated(code);
    const container = createContainer();
    mod.mountComponent(container);

    mod.visible(false);
    mod.update_visible();
    mod.count(7); // changes while unmounted
    mod.visible(true);
    mod.update_visible();

    // freshly (re-)mounted content reflects the current signal value
    expect(container.querySelector('span').textContent).toBe('7');

    mod.count(8);
    mod.update_count();
    expect(container.querySelector('span').textContent).toBe('8');
  });

  it('supports the ternary form with two real branches', async () => {
    const { initialHtml, code } = compile(TERNARY_SOURCE);
    expect(initialHtml).toBe('<div><!--m0--><span>yes</span></div>');

    const mod = await loadGenerated(code);
    const container = createContainer();
    mod.mountComponent(container);

    mod.on(false);
    mod.update_on();
    expect(container.innerHTML).toBe('<div><!--m0--><em>no</em></div>');

    mod.on(true);
    mod.update_on();
    expect(container.innerHTML).toBe('<div><!--m0--><span>yes</span></div>');
  });
});
