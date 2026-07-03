import { describe, it, expect } from 'vitest';
import { compile } from '../src/compiler.js';
import { createContainer, loadGenerated } from './helpers.js';

// docs/adr/0001-first-milestone.md の先送り項目その1:コンポーネント間の
// props 伝播。`<Child count={count()} />` は追跡済み signal の裸のパス
// スルーなので、Child の `prop('count')` は Parent の `count` と*同じ*
// declId へのエイリアスになる - 別のストレージが無いため、どちら側からの
// 書き込みも両側から見える(write-back のための逆向きグラフ辺は不要)。
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

// リテラル(や計算を含む、裸の読み取りでない)prop 値は一般に write-back
// できないので、独立したローカル signal に昇格する。
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

    // 親 -> 子
    mod.count(5);
    mod.update_count();
    expect(container.querySelector('[data-iris-id="m0"]').textContent).toBe('5');

    // 子 -> 親(write-back):真のエイリアスなので signal は1つしかなく、
    // 「子の側」から同じアクセサ経由で書くことは親の側から書くことと
    // 区別がつかない - それこそが狙い。
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
