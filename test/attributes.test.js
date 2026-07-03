import { describe, it, expect } from 'vitest';
import { compile } from '../src/compiler.js';

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

  it('throws a scope-limit error for a dynamic (expression) attribute on a host element', () => {
    const source = `
export function App() {
  const theme = signal('dark');
  return <div class={theme()}>t</div>;
}
`;
    expect(() => compile(source)).toThrow(/scope limit/);
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
