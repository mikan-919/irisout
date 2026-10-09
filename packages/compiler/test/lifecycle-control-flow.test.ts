// 初期化の途中返却でも、選択した更新・後始末だけを所有し、変数の閉包と更新時点を保つか検証する。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

interface LifecycleState {
  branch: string
  log: string[]
  failure: Error
}

interface Instance {
  mount(container: Element): void
  hydrate(container: Element): void
  unmount(): void
}

function state(): LifecycleState {
  return (globalThis as typeof globalThis & { __irisoutLifecycleFlow: LifecycleState })
    .__irisoutLifecycleFlow
}

async function load(source: string): Promise<{
  container: Element
  instance: Instance
  initialHtml: string
}> {
  const { code, initialHtml } = compile(source)
  const mod = await loadGenerated(code)
  return {
    container: createContainer(),
    instance: (mod.createComponent as () => Instance)(),
    initialHtml,
  }
}

function click(container: Element, selector = 'button'): void {
  const element = container.querySelector(selector)
  if (!element) throw new Error(`lifecycle test element missing: ${selector}`)
  element.dispatchEvent(new container.ownerDocument.defaultView!.Event('click', { bubbles: true }))
}

beforeEach(() => {
  vi.stubGlobal('__irisoutLifecycleFlow', {
    branch: 'a',
    log: [],
    failure: new Error('lifecycle failure'),
  } satisfies LifecycleState)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useの初期化の制御フロー', () => {
  it('返却した更新関数はconstとfinallyで変更したletを閉包する', async () => {
    const { container, instance } = await load(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button use={setup}>ready</button></div>);
  function setup(el) {
    const prefix = 'captured';
    let label = 'before';
    try {
      value(1);
      if (globalThis.__irisoutLifecycleFlow.branch === 'a') {
        return {
          update() { el.setAttribute('data-value', prefix + ':' + label + ':' + value()); },
          destroy() { globalThis.__irisoutLifecycleFlow.log.push(prefix + ':' + label); }
        };
      }
      return () => { el.setAttribute('data-value', 'other'); };
    } finally { label = 'after'; value(2); }
  }
}
`)
    instance.mount(container)
    expect(container.querySelector('span')!.textContent).toBe('2')
    expect(container.querySelector('button')!.getAttribute('data-value')).toBe('captured:after:2')
    instance.unmount()
    instance.unmount()
    expect(state().log).toEqual(['captured:after'])
  })

  it.each(['a', 'b'])('選択した分岐%sのupdateとdestroyだけを実行する', async (branch) => {
    state().branch = branch
    const { container, instance } = await load(`
export function App() {
  const left = signal(0);
  const right = signal(0);
  render(<div><button id="advance" onClick={advance}>advance</button><canvas use={setup}/></div>);
  function setup(el) {
    const chosen = globalThis.__irisoutLifecycleFlow.branch;
    if (chosen === 'a') return {
      update() { globalThis.__irisoutLifecycleFlow.log.push('a-' + left()); },
      destroy() { globalThis.__irisoutLifecycleFlow.log.push('destroy-a'); }
    };
    return {
      update() { globalThis.__irisoutLifecycleFlow.log.push('b-' + right()); },
      destroy() { globalThis.__irisoutLifecycleFlow.log.push('destroy-b'); }
    };
  }
  function advance() { left(1); right(1); }
}
`)
    instance.mount(container)
    expect(state().log).toEqual([`${branch}-0`])
    click(container, '#advance')
    expect(state().log).toEqual([`${branch}-0`, `${branch}-1`])
    instance.unmount()
    instance.unmount()
    expect(state().log).toEqual([`${branch}-0`, `${branch}-1`, `destroy-${branch}`])
  })

  it('書込み前のreturnは他のactionを更新しない', async () => {
    const { container, instance } = await load(`
export function App() {
  const value = signal(0);
  render(<div><canvas use={watch}/><button use={setup}>ready</button></div>);
  function watch(el) { return () => { globalThis.__irisoutLifecycleFlow.log.push('watch-' + value()); }; }
  function setup(el) {
    if (globalThis.__irisoutLifecycleFlow.branch === 'a') return;
    value(1);
    return () => { el.setAttribute('data-ready', 'yes'); };
  }
}
`)
    instance.mount(container)
    expect(state().log).toEqual(['watch-0'])
    expect(container.querySelector('button')!.hasAttribute('data-ready')).toBe(false)
    instance.unmount()
  })

  it('return式の評価後にfinallyを実行し書込みを更新する', async () => {
    const { container, instance } = await load(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><canvas use={setup}/></div>);
  function setup(el) {
    try {
      value(1);
      return globalThis.__irisoutLifecycleFlow.log.push('result')
        ? { destroy() { globalThis.__irisoutLifecycleFlow.log.push('destroy'); } }
        : () => {};
    }
    finally { globalThis.__irisoutLifecycleFlow.log.push('finally'); value(2); }
  }
}
`)
    instance.mount(container)
    expect(container.querySelector('span')!.textContent).toBe('2')
    expect(state().log).toEqual(['result', 'finally'])
    instance.unmount()
    expect(state().log).toEqual(['result', 'finally', 'destroy'])
  })

  it('書込み後にthrowしてもfinallyの状態を反映して既登録destroyを回収する', async () => {
    const { container, instance } = await load(`
export function App() {
  const value = signal(0);
  render(<div><canvas use={watch}/><button use={fail}>fail</button></div>);
  function watch(el) { return {
    update() { globalThis.__irisoutLifecycleFlow.log.push('watch-' + value()); },
    destroy() { globalThis.__irisoutLifecycleFlow.log.push('destroy-watch'); }
  }; }
  function fail(el) {
    try { value(1); throw globalThis.__irisoutLifecycleFlow.failure; }
    finally { value(2); }
  }
}
`)
    let caught: unknown
    try {
      instance.mount(container)
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(state().failure)
    expect(state().log).toEqual(['watch-0', 'watch-2', 'destroy-watch'])
    expect(container.childElementCount).toBe(0)
    instance.unmount()
    expect(state().log).toHaveLength(3)
  })

  it('destroyだけが読む状態をupdateの依存へ含めない', async () => {
    const { container, instance } = await load(`
export function App() {
  const tick = signal(0);
  const cleanupValue = signal(0);
  render(<div><canvas use={setup}/><button onClick={advance}>advance</button></div>);
  function setup(el) {
    if (globalThis.__irisoutLifecycleFlow.branch === 'a') return {
      update() { globalThis.__irisoutLifecycleFlow.log.push('update-' + tick()); },
      destroy() { globalThis.__irisoutLifecycleFlow.log.push('destroy-' + cleanupValue()); }
    };
    return;
  }
  function advance() { cleanupValue(1); }
}
`)
    instance.mount(container)
    click(container)
    expect(state().log).toEqual(['update-0'])
    instance.unmount()
    expect(state().log).toEqual(['update-0', 'destroy-1'])
  })
})

describe('onMountの初期化の制御フロー', () => {
  it.each(['mount', 'hydrate'] as const)(
    '選択したcleanupを%s後に逆順で一度だけ実行する',
    async (mode) => {
      const { container, instance, initialHtml } = await load(`
export function App() {
  const value = signal(0);
  render(<span>{value()}</span>);
  onMount(() => {
    const label = 'first-' + globalThis.__irisoutLifecycleFlow.branch;
    if (globalThis.__irisoutLifecycleFlow.branch === 'a') {
      value(1);
      return () => { globalThis.__irisoutLifecycleFlow.log.push(label); return 41; };
    }
    return () => { globalThis.__irisoutLifecycleFlow.log.push('other-first'); };
  });
  onMount(() => {
    let label = 'before';
    try { if (value() === 1) return () => { globalThis.__irisoutLifecycleFlow.log.push(label); }; }
    finally { label = 'second-after'; value(2); }
  });
}
`)
      if (mode === 'hydrate') {
        container.innerHTML = initialHtml
        instance.hydrate(container)
      } else instance.mount(container)
      expect(container.querySelector('span')!.textContent).toBe('2')
      expect(state().log).toEqual([])
      instance.unmount()
      instance.unmount()
      expect(state().log).toEqual(['second-after', 'first-a'])
    },
  )

  it('書込み前のreturnは既存actionの更新を起こさない', async () => {
    const { container, instance } = await load(`
export function App() {
  const value = signal(0);
  render(<canvas use={watch}/>);
  onMount(() => { if (value() === 0) return; value(1); });
  function watch(el) { return () => { globalThis.__irisoutLifecycleFlow.log.push('watch-' + value()); }; }
}
`)
    instance.mount(container)
    expect(state().log).toEqual(['watch-0'])
    instance.unmount()
  })

  it('後続初期化の失敗時は選択して登録したcleanupだけを回収する', async () => {
    const { container, instance } = await load(`
export function App() {
  render(<div>ready</div>);
  onMount(() => {
    if (globalThis.__irisoutLifecycleFlow.branch === 'a') return () => { globalThis.__irisoutLifecycleFlow.log.push('first-a'); };
    return () => { globalThis.__irisoutLifecycleFlow.log.push('first-b'); };
  });
  onMount(() => {
    if (globalThis.__irisoutLifecycleFlow.branch === 'a') return () => { globalThis.__irisoutLifecycleFlow.log.push('second-a'); };
    return;
  });
  onMount(() => { throw globalThis.__irisoutLifecycleFlow.failure; });
}
`)
    let caught: unknown
    try {
      instance.mount(container)
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(state().failure)
    expect(state().log).toEqual(['second-a', 'first-a'])
    expect(container.childElementCount).toBe(0)
    instance.unmount()
    expect(state().log).toEqual(['second-a', 'first-a'])
  })

  it('cleanupがthrowしても残りのcleanupを回収し二度実行しない', async () => {
    const { container, instance } = await load(`
export function App() {
  render(<div>ready</div>);
  onMount(() => {
    if (globalThis.__irisoutLifecycleFlow.branch === 'a') return () => { globalThis.__irisoutLifecycleFlow.log.push('first'); };
    return;
  });
  onMount(() => {
    if (globalThis.__irisoutLifecycleFlow.branch === 'a') return () => {
      globalThis.__irisoutLifecycleFlow.log.push('second');
      throw globalThis.__irisoutLifecycleFlow.failure;
    };
    return;
  });
}
`)
    instance.mount(container)
    let caught: unknown
    try {
      instance.unmount()
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(state().failure)
    expect(state().log).toEqual(['second', 'first'])
    expect(() => instance.unmount()).not.toThrow()
    expect(state().log).toEqual(['second', 'first'])
  })

  it('式本体で呼ぶsetupの返り値は従来どおり捨てる', async () => {
    const { container, instance } = await load(`
export function App() {
  render(<div>ready</div>);
  onMount(() => setup());
  effect(() => setup());
  function setup() {
    globalThis.__irisoutLifecycleFlow.log.push('setup');
    return () => { globalThis.__irisoutLifecycleFlow.log.push('discarded'); };
  }
}
`)
    instance.mount(container)
    expect(state().log).toEqual(['setup', 'setup'])
    instance.unmount()
    expect(state().log).toEqual(['setup', 'setup'])
  })
})

describe('構造unitとeffectの返却所有', () => {
  it('keyの再利用では再初期化せず脱落したitemの分岐cleanupだけを実行する', async () => {
    const { container, instance } = await load(`
function Row({ item }) {
  render(<li key={item.id} use={setup}>{item.id}</li>);
  onMount(() => {
    const id = item.id;
    if (id === 1) return () => { globalThis.__irisoutLifecycleFlow.log.push('mount-' + id); };
    return;
  });
  function setup(el) {
    const id = item.id;
    globalThis.__irisoutLifecycleFlow.log.push('setup-' + id);
    if (id === 1) return { destroy() { globalThis.__irisoutLifecycleFlow.log.push('action-' + id); } };
    return { destroy() { globalThis.__irisoutLifecycleFlow.log.push('other-' + id); } };
  }
}
export function App() {
  const items = signal([{ id: 1 }, { id: 2 }]);
  render(<div><button id="shuffle" onClick={shuffle}>shuffle</button><button id="remove" onClick={remove}>remove</button>
    <ul>{items().map(item => <Row key={item.id} item={item}/>)}</ul></div>);
  function shuffle() { items([{ id: 2 }, { id: 1 }]); }
  function remove() { items([{ id: 2 }]); }
}
`)
    instance.mount(container)
    const first = container.querySelectorAll('li')[0]!
    const second = container.querySelectorAll('li')[1]!
    expect(state().log).toEqual(['setup-1', 'setup-2'])
    click(container, '#shuffle')
    expect(container.querySelectorAll('li')[0]).toBe(second)
    expect(container.querySelectorAll('li')[1]).toBe(first)
    expect(state().log).toEqual(['setup-1', 'setup-2'])
    click(container, '#remove')
    expect(state().log.slice(2).sort()).toEqual(['action-1', 'mount-1'])
    instance.unmount()
    instance.unmount()
    expect(state().log.slice(2).sort()).toEqual(['action-1', 'mount-1', 'other-2'])
  })

  it('effectは分岐変更前のcleanupだけを実行してvoid分岐で所有を空にする', async () => {
    const { container, instance } = await load(`
export function App() {
  const value = signal(0);
  render(<button onClick={advance}>advance</button>);
  effect(() => {
    const current = value();
    globalThis.__irisoutLifecycleFlow.log.push('run-' + current);
    if (current === 0) return () => { globalThis.__irisoutLifecycleFlow.log.push('cleanup-zero'); };
    if (current === 1) return;
    return () => { globalThis.__irisoutLifecycleFlow.log.push('cleanup-' + current); };
  });
  function advance() { value(value() + 1); }
}
`)
    instance.mount(container)
    expect(state().log).toEqual(['run-0'])
    click(container)
    expect(state().log).toEqual(['run-0', 'cleanup-zero', 'run-1'])
    click(container)
    expect(state().log).toEqual(['run-0', 'cleanup-zero', 'run-1', 'run-2'])
    instance.unmount()
    instance.unmount()
    expect(state().log).toEqual(['run-0', 'cleanup-zero', 'run-1', 'run-2', 'cleanup-2'])
  })

  it('cleanupだけが読むsignalをeffectの依存へ含めない', async () => {
    const { container, instance } = await load(`
export function App() {
  const tick = signal(0);
  const cleanupValue = signal(0);
  render(<button onClick={advance}>advance</button>);
  effect(() => {
    const current = tick();
    globalThis.__irisoutLifecycleFlow.log.push('run-' + current);
    if (current === 0) return () => { globalThis.__irisoutLifecycleFlow.log.push('cleanup-' + cleanupValue()); };
    return;
  });
  function advance() { cleanupValue(1); }
}
`)
    instance.mount(container)
    click(container)
    expect(state().log).toEqual(['run-0'])
    instance.unmount()
    expect(state().log).toEqual(['run-0', 'cleanup-1'])
  })

  it('条件式の返却がcleanupからundefinedやvoidへ切り替わると所有を空にする', async () => {
    const { container, instance } = await load(`
export function App() {
  const value = signal(0);
  render(<button onClick={advance}>advance</button>);
  effect(() => {
    const current = value();
    globalThis.__irisoutLifecycleFlow.log.push('run-' + current);
    return current === 0
      ? () => { globalThis.__irisoutLifecycleFlow.log.push('cleanup-zero'); }
      : current === 1 ? undefined : void globalThis.__irisoutLifecycleFlow.log.push('void-' + current);
  });
  function advance() { value(value() + 1); }
}
`)
    instance.mount(container)
    click(container)
    click(container)
    expect(state().log).toEqual(['run-0', 'cleanup-zero', 'run-1', 'run-2', 'void-2'])
    instance.unmount()
    instance.unmount()
    expect(state().log).toEqual(['run-0', 'cleanup-zero', 'run-1', 'run-2', 'void-2'])
  })

  it('構造unitのcleanup内の補助関数による書込みはrootのDOMへ反映しない', async () => {
    const { container, instance } = await load(`
function Child({ write }) {
  render(<span>child</span>);
  onMount(() => {
    if (globalThis.__irisoutLifecycleFlow.branch === 'a') return () => { write(); };
    return;
  });
}
export function App() {
  const value = signal(0);
  const visible = signal(true);
  render(<div><span id="value">{value()}</span><button onClick={hide}>hide</button>{visible() && <Child write={write}/>}</div>);
  function write() { value(9); globalThis.__irisoutLifecycleFlow.log.push('cleanup-write'); }
  function hide() { visible(false); }
}
`)
    instance.mount(container)
    click(container)
    expect(container.querySelector('#value')!.textContent).toBe('0')
    expect(state().log).toEqual(['cleanup-write'])
    instance.unmount()
    expect(state().log).toEqual(['cleanup-write'])
  })

  it('普通の内部関数のreturn値をcleanup形の検査へ混ぜない', async () => {
    const { container, instance } = await load(`
export function App() {
  render(<div>ready</div>);
  onMount(() => {
    function number() { return 41; }
    globalThis.__irisoutLifecycleFlow.log.push('number-' + number());
    if (globalThis.__irisoutLifecycleFlow.branch === 'a') return () => { return 42; };
    return;
  });
}
`)
    instance.mount(container)
    expect(state().log).toEqual(['number-41'])
    instance.unmount()
    expect(state().log).toEqual(['number-41'])
  })

  it.each([
    'if (value() === 0) { value(1); return; }',
    'if (value() === 0) return () => { value(1); };',
    'if (value() === 0) return () => { write(); };',
    'try { return () => {}; } finally { value(1); }',
  ])('effectの全分岐で追跡対象への書込みを拒否する: %s', (body) => {
    expect(() =>
      compile(`
export function App() {
  const value = signal(0);
  render(<div/>);
  effect(() => { ${body} });
  function write() { value(1); }
}
`),
    ).toThrow(/effect\(\) cannot write tracked signals.*scope limit/)
  })
})

describe('初期化の全returnで返却形を検証する', () => {
  it('ジェネレーターの初期化を通常関数として生成しない', () => {
    expect(() =>
      compile(
        `export function App() { render(<div use={setup}/>); function* setup(el) { yield 1; } }`,
      ),
    ).toThrow(/generator function bodies.*scope limit/)
  })
  it.each(['use', 'onMount'])('%sの式本体で書込みと条件式の返却を保持する', async (api) => {
    const source =
      api === 'use'
        ? `export function App() { const value = signal(0); render(<div><span>{value()}</span><canvas use={el => value(1) ? (() => { el.setAttribute('data-value', String(value())); }) : undefined}/></div>); }`
        : `export function App() { const value = signal(0); render(<span>{value()}</span>); onMount(() => value(1) ? (() => { globalThis.__irisoutLifecycleFlow.log.push('cleanup-' + value()); }) : undefined); }`
    const { container, instance } = await load(source)
    instance.mount(container)
    expect(container.querySelector('span')!.textContent).toBe('1')
    if (api === 'use')
      expect(container.querySelector('canvas')!.getAttribute('data-value')).toBe('1')
    instance.unmount()
    if (api === 'onMount') expect(state().log).toEqual(['cleanup-1'])
  })

  it.each([
    'render(<div use={async el => { await Promise.resolve(); }}/>);',
    'render(<div use={setup}/>); async function setup(el) { await Promise.resolve(); }',
    'render(<div/>); onMount(async () => { await Promise.resolve(); });',
    'render(<div/>); effect(async () => { await Promise.resolve(); });',
  ])('非同期初期化を位置付き診断で拒否する: %s', (body) => {
    expect(() => compile(`export function App() { ${body} }`)).toThrow(
      /initialization must be synchronous.*scope limit.*<source>:\d+:\d+/,
    )
  })

  it.each([
    '42',
    '(value) => {}',
    '{ update: 42 }',
    '{ destroy(value) {} }',
    '{ update() {}, unknown() {} }',
    '{ update() {}, update() {} }',
  ])('useの途中returnの不正な返却値を拒否する: %s', (returned) => {
    expect(() =>
      compile(`
export function App() {
  render(<canvas use={setup}/>);
  function setup(el) {
    if (globalThis.__irisoutLifecycleFlow.branch === 'a') return ${returned};
    return { destroy() {} };
  }
}
`),
    ).toThrow(/compile:.*scope limit/)
  })

  it.each(['onMount', 'effect'])('%sの途中returnのobjectをcleanupとして受理しない', (api) => {
    expect(() =>
      compile(`
export function App() {
  render(<div/>);
  ${api}(() => {
    if (globalThis.__irisoutLifecycleFlow.branch === 'a') return { destroy() {} };
    return () => {};
  });
}
`),
    ).toThrow(/compile:.*scope limit/)
  })

  it.each(['onMount', 'effect'])('%sのfinally内の不正なreturnも拒否する', (api) => {
    expect(() =>
      compile(`
export function App() {
  render(<div/>);
  ${api}(() => { try { return () => {}; } finally { return 42; } });
}
`),
    ).toThrow(/compile:.*scope limit/)
  })
})
