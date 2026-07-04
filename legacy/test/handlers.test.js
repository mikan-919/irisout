import { describe, it, expect } from 'vitest';
import { compile } from '../src/compiler.js';
import { createContainer, loadGenerated } from './helpers.js';

// docs/adr/0002-event-handlers.md:host 要素の `onClick={...}` を静的解析し、
// 中の signal 書き込みを検出して、対応する update_* をハンドラ末尾で自動的に
// 呼ぶ。これまでは生成された signal アクセサと update 関数を手で順番に
// 叩く以外に生成物を動かす手段が無かった - このテストは手動での update
// 関数呼び出しなしで、クリックだけで DOM が更新されることを確認する。
const COUNTER_SOURCE = `
export function Counter() {
  const count = signal(0);
  const doubled = derived(() => count() * 2);
  return <div><span>{doubled()}</span><button onClick={() => count(count() + 1)}>+</button></div>;
}
`;

// prop エイリアス(src/compiler.js:17-20)経由の write-back:子の
// `prop('count')` は親の signal と同じ declId なので、子側のボタンが書いた
// 値は「親側の」update_count() 呼び出しとして現れ、親側マーカーが更新される。
const ALIAS_SOURCE = `
function Child() {
  const count = prop('count');
  return <button onClick={() => count(count() + 1)}>+</button>;
}

function Parent() {
  const count = signal(0);
  return <div><span>{count()}</span><Child count={count()} /></div>;
}
`;

// 1回のクリックで2つの異なる signal に書き込む - 生成コードに両方の
// update_* 呼び出しが現れ、両方のマーカーが更新されることを確認する。
const TWO_WRITES_SOURCE = `
export function App() {
  const a = signal(0);
  const b = signal(0);
  return <div><span>{a()}</span><span>{b()}</span><button onClick={() => { a(a() + 1); b(b() + 1); }}>+</button></div>;
}
`;

function dispatchClick(container, el) {
  const Event = container.ownerDocument.defaultView.Event;
  el.dispatchEvent(new Event('click'));
}

describe('event handlers compile signal writes into automatic update_* calls', () => {
  it('a click on the button updates the derived-dependent marker with no manual update_* call', async () => {
    const { code } = compile(COUNTER_SOURCE);
    expect(code).toContain('addEventListener("click"');
    expect(code).toContain('update_count();');

    const mod = await loadGenerated(code);
    const container = createContainer();
    mod.mountComponent(container);

    expect(container.querySelector('span').textContent).toBe('0');
    dispatchClick(container, container.querySelector('button'));
    expect(container.querySelector('span').textContent).toBe('2');
  });

  it('writes back through a prop alias: the child button click updates the parent-side marker', async () => {
    const { code } = compile(ALIAS_SOURCE);
    const mod = await loadGenerated(code);
    const container = createContainer();
    mod.mountComponent(container);

    expect(container.querySelector('span').textContent).toBe('0');
    dispatchClick(container, container.querySelector('button'));
    expect(container.querySelector('span').textContent).toBe('1');
  });

  it('emits one update_* per distinct written signal, and both markers update after one click', async () => {
    const { code } = compile(TWO_WRITES_SOURCE);
    expect(code).toContain('update_a();');
    expect(code).toContain('update_b();');

    const mod = await loadGenerated(code);
    const container = createContainer();
    mod.mountComponent(container);

    const [spanA, spanB] = container.querySelectorAll('span');
    expect(spanA.textContent).toBe('0');
    expect(spanB.textContent).toBe('0');

    dispatchClick(container, container.querySelector('button'));
    expect(spanA.textContent).toBe('1');
    expect(spanB.textContent).toBe('1');
  });

  it('throws at compile time when a handler writes to a derived', () => {
    const source = `
export function App() {
  const count = signal(0);
  const doubled = derived(() => count() * 2);
  return <div><span>{doubled()}</span><button onClick={() => doubled(5)}>+</button></div>;
}
`;
    expect(() => compile(source)).toThrow(/cannot write to derived/);
  });

  it('throws a scope-limit error for a handler inside a conditional branch', () => {
    const source = `
export function App() {
  const visible = signal(true);
  const count = signal(0);
  return <div>{visible() && <button onClick={() => count(count() + 1)}>+</button>}</div>;
}
`;
    expect(() => compile(source)).toThrow(/scope limit/);
  });

  it('throws a scope-limit error for a handler inside a list item template', () => {
    const source = `
export function App() {
  const items = signal([{ id: 1 }]);
  return <ul>{items().map((item) => <li key={item.id} onClick={() => items([])}>{item.id}</li>)}</ul>;
}
`;
    expect(() => compile(source)).toThrow(/scope limit/);
  });
});
