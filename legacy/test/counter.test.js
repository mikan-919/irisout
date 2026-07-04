import { describe, it, expect } from 'vitest';
import { compile } from '../src/compiler.js';
import { createContainer, loadGenerated } from './helpers.js';

// マイルストーン1の唯一のサンプル:単一コンポーネント、単一 signal、そして
// 複数の自由変数依存(count + doubled)を持つ JSX 式。doubled 自体は count
// から derive されている。パイプライン全体を end to end で通す
// (docs/adr/0001-first-milestone.md)。
const COUNTER_SOURCE = `
export function Counter() {
  const count = signal(0);
  const doubled = derived(() => count() * 2);
  return <div>{count() + doubled()}</div>;
}
`;

describe('milestone 1: expression dependency analysis -> update_* codegen', () => {
  it('bakes the real initial HTML from build-time execution', () => {
    const { initialHtml } = compile(COUNTER_SOURCE);
    expect(initialHtml).toBe('<div data-iris-id="m0">0</div>');
  });

  it('resolves the derived dependency transitively onto the root signal', () => {
    const { signalToMarkers, declName } = compile(COUNTER_SOURCE);
    const names = [...signalToMarkers.keys()].map((id) => declName.get(id));
    expect(names).toEqual(['count']);
    expect([...signalToMarkers.values()][0]).toEqual(new Set(['m0']));
  });

  it('generates a dedicated update_count() that recomputes through derived(), and nothing for derived itself', async () => {
    const { code } = compile(COUNTER_SOURCE);
    const mod = await loadGenerated(code);

    expect(mod.update_doubled).toBeUndefined();

    const container = createContainer();
    mod.mountComponent(container);

    mod.count(5);
    mod.update_count();

    expect(container.querySelector('[data-iris-id="m0"]').textContent).toBe('15');
  });

  it('throws if the component does not return a single JSX element (milestone 1 scope)', () => {
    expect(() => compile('export function Bad() { return null; }')).toThrow();
  });
});
