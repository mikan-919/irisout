import { describe, it, expect } from 'vitest';
import { compile } from '../src/compiler.js';
import { createContainer, loadGenerated } from './helpers.js';

// docs/adr/0001-first-milestone.md の先送り項目その3:構造更新(スコープを
// 条件レンダリングのみに絞ったもの。リストはまだ先送り)。
// `visible() && <span>{count()}</span>` はこのマイルストーンが対応する
// 両形式を混ぜている:常に存在するコメントアンカーがブランチの挿入/削除を
// 駆動し、ブランチ自身のネストしたリアクティブ式が、挿入されたサブツリーの
// マーカーが動的に発見・接続されることを証明する。
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

    // 削除されたブランチ自身の signal には、もう更新対象が何もない
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
    mod.count(7); // アンマウント中に値が変わる
    mod.visible(true);
    mod.update_visible();

    // (再)マウントされたばかりの内容は現在の signal 値を反映する
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
