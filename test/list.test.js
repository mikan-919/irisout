import { describe, it, expect } from 'vitest';
import { compile } from '../src/compiler.js';
import { createContainer, loadGenerated } from './helpers.js';

// docs/adr/0001-first-milestone.md の先送り項目その4:リストの構造更新。
// リコンシリエーションは意図的に素朴(src/compiler.js ヘッダー参照)-
// key による再利用と、並べ替えのための insertBefore の繰り返し。
// LIS ベースの最小移動 diff はまだない(フォローアップ予定)。
const LIST_SOURCE = `
function App() {
  const items = signal([{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }]);
  return <ul>{items().map(item => <li key={item.id}>{item.name}</li>)}</ul>;
}
`;

describe('keyed lists', () => {
  it('bakes the initial HTML with start/end range anchors around the items', () => {
    const { initialHtml } = compile(LIST_SOURCE);
    expect(initialHtml).toBe('<ul><!--m0_start--><li>a</li><li>b</li><li>c</li><!--m0_end--></ul>');
  });

  it('removes departed keys and adds new ones', async () => {
    const { code } = compile(LIST_SOURCE);
    const mod = await loadGenerated(code);
    const container = createContainer();
    mod.mountComponent(container);

    mod.items([{ id: 2, name: 'b' }, { id: 4, name: 'd' }]);
    mod.update_items();
    expect(container.querySelector('ul').innerHTML).toBe('<!--m0_start--><li>b</li><li>d</li><!--m0_end-->');
  });

  it('reuses the existing element for a retained key, refreshing its content, and preserves identity (no rebuild)', async () => {
    const { code } = compile(LIST_SOURCE);
    const mod = await loadGenerated(code);
    const container = createContainer();
    mod.mountComponent(container);

    const originalLi = container.querySelectorAll('li')[0];
    originalLi.dataset.marker = 'still-me';

    mod.items([{ id: 1, name: 'A (renamed)' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }]);
    mod.update_items();

    const updatedLi = container.querySelectorAll('li')[0];
    expect(updatedLi).toBe(originalLi); // 同じノード。作り直しではない
    expect(updatedLi.dataset.marker).toBe('still-me'); // 更新を生き延びた
    expect(updatedLi.textContent).toBe('A (renamed)'); // 内容は更新済み
  });

  it('reorders existing elements to match the new key order via insertBefore', async () => {
    const { code } = compile(LIST_SOURCE);
    const mod = await loadGenerated(code);
    const container = createContainer();
    mod.mountComponent(container);

    const [liA, liB, liC] = container.querySelectorAll('li');

    mod.items([{ id: 3, name: 'c' }, { id: 1, name: 'a' }, { id: 2, name: 'b' }]);
    mod.update_items();

    const reordered = [...container.querySelectorAll('li')];
    expect(reordered).toEqual([liC, liA, liB]); // 同じノード群、新しい順序
  });

  it('handles an empty result with no leftover elements', async () => {
    const { code } = compile(LIST_SOURCE);
    const mod = await loadGenerated(code);
    const container = createContainer();
    mod.mountComponent(container);

    mod.items([]);
    mod.update_items();
    expect(container.querySelector('ul').innerHTML).toBe('<!--m0_start--><!--m0_end-->');
  });
});
