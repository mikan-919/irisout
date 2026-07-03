import { describe, it, expect } from 'vitest';
import { compile } from '../src/compiler.js';
import { createContainer, loadGenerated } from './helpers.js';

// First deferred item from docs/adr/0001-first-milestone.md: props propagation
// between components. `<Child count={count()} />` is a bare pass-through of an
// already-tracked signal, so Child's `prop('count')` is aliased to the SAME
// declId as Parent's `count` - no separate storage, so a write from either
// side is visible from both (no reverse graph edges needed for write-back).
const ALIASED_SOURCE = `
function Child() {
  const count = prop('count');
  return <span>{count()}</span>;
}

function Parent() {
  const count = signal(0);
  return <div><Child count={count()} /></div>;
}
`;

// A literal (or any computed, non-bare-read) prop value can't be written back
// to in general, so it's promoted to an independent local signal instead.
const LITERAL_SOURCE = `
function Child() {
  const label = prop('label');
  return <span>{label()}</span>;
}

function Parent() {
  return <div><Child label="hi" /></div>;
}
`;

describe('props propagation across component boundaries', () => {
  it('aliases a bare-read prop to the parent signal: no update_<child-name> exists, only update_<parent-signal>', () => {
    const { signalToMarkers, declName } = compile(ALIASED_SOURCE);
    const names = [...signalToMarkers.keys()].map((id) => declName.get(id));
    expect(names).toEqual(['count']);
    expect([...signalToMarkers.values()][0]).toEqual(new Set(['m0']));
  });

  it('one update_count() updates both the parent-side and the aliased child-side marker, from either direction', async () => {
    const { code } = compile(ALIASED_SOURCE);
    const mod = await loadGenerated(code);
    const container = createContainer();
    mod.mountComponent(container);

    // parent -> child
    mod.count(5);
    mod.update_count();
    expect(container.querySelector('[data-iris-id="m0"]').textContent).toBe('5');

    // child -> parent (write-back): since it's a true alias there is only one
    // signal, so writing through the same accessor from "the child's side" is
    // indistinguishable from writing from the parent's - that's the point.
    mod.count(9);
    mod.update_count();
    expect(container.querySelector('[data-iris-id="m0"]').textContent).toBe('9');
  });

  it('promotes a literal prop to an independent signal owned by the child', async () => {
    const { code, initialHtml } = compile(LITERAL_SOURCE);
    expect(initialHtml).toBe('<div><span data-iris-id="m0">hi</span></div>');

    const mod = await loadGenerated(code);
    expect(mod.label).toBeTypeOf('function');

    const container = createContainer();
    mod.mountComponent(container);
    mod.label('bye');
    mod.update_label();
    expect(container.querySelector('[data-iris-id="m0"]').textContent).toBe('bye');
  });
});
