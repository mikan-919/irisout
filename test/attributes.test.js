import { describe, it, expect } from 'vitest';
import { compile } from '../src/compiler.js';
import { createContainer, loadGenerated } from './helpers.js';

describe('static host-element attributes compile into the baked HTML', () => {
  it('keeps a plain string attribute', () => {
    const { initialHtml } = compile(`
export function App() {
  return <div class="app">hi</div>;
}
`);
    expect(initialHtml).toBe('<div class="app">hi</div>');
  });

  it('keeps multiple attributes in source order, ahead of data-iris-id when the element also has a marker', () => {
    const { initialHtml } = compile(`
export function App() {
  const count = signal(0);
  return <div class="app" data-role="counter">{count()}</div>;
}
`);
    expect(initialHtml).toBe('<div class="app" data-role="counter" data-iris-id="m0">0</div>');
  });

  it('renders a valueless attribute as a bare boolean attribute', () => {
    const { initialHtml } = compile(`
export function App() {
  return <button disabled>go</button>;
}
`);
    expect(initialHtml).toBe('<button disabled>go</button>');
  });

  it('HTML-entity-escapes double quotes in the attribute value', () => {
    const { initialHtml } = compile(`
export function App() {
  return <div title='say "hi"'>t</div>;
}
`);
    expect(initialHtml).toBe('<div title="say &quot;hi&quot;">t</div>');
  });

  it('passes template-literal-sensitive characters through unharmed and uninterpolated', () => {
    const { initialHtml } = compile('export function App() { return <div title="`x` and ${y}">t</div>; }');
    expect(initialHtml).toBe('<div title="`x` and ${y}">t</div>');
  });

  it('renders the initial value of a dynamic attribute', () => {
    const { initialHtml } = compile(`
export function App() {
  const theme = signal('dark');
  return <div class={theme()}>t</div>;
}
`);
    expect(initialHtml).toBe('<div class="dark" data-iris-id="m0">t</div>');
  });

  it('updates a dynamic attribute when its signal changes, with no direct text marker needed', async () => {
    const { code } = compile(`
export function App() {
  const theme = signal('dark');
  return <div class={theme()} onClick={() => theme('light')}>t</div>;
}
`);
    const mod = await loadGenerated(code);
    const container = createContainer();
    mod.mountComponent(container);

    const div = container.querySelector('div');
    expect(div.getAttribute('class')).toBe('dark');
    div.dispatchEvent(new container.ownerDocument.defaultView.Event('click'));
    expect(div.getAttribute('class')).toBe('light');
  });

  it('static attributes coexist with a working click handler', async () => {
    const { code, initialHtml } = compile(`
export function App() {
  const count = signal(0);
  return <button class="btn" onClick={() => count(count() + 1)}>{count()}</button>;
}
`);
    // initialHtml は生 HTML、code はそれを JSON.stringify で埋め込むため
    // ここでは code 側でなく initialHtml 側で class= を確認する。
    expect(initialHtml).toContain('class="btn"');
    expect(code).toContain('addEventListener("click"');
  });
});
