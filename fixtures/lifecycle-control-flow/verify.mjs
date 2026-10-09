// 分岐と途中返却を持つ初期化をChromiumで操作し、選択した返却と所有期間を検証する。
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = path.resolve(
  process.env.IRISOUT_REPO_ROOT ?? path.join(import.meta.dirname, '../..'),
)
const { compile } = await import(
  pathToFileURL(path.join(repoRoot, 'packages/compiler/src/compiler.ts')).href
)
const benchRequire = createRequire(path.join(repoRoot, 'packages/bench/package.json'))
const playwright = await import(pathToFileURL(benchRequire.resolve('playwright')).href)
const { chromium } = playwright.default ?? playwright
const outputDirectory =
  process.env.IRISOUT_LIFECYCLE_ARTIFACTS ?? '/tmp/irisout-lifecycle-control-flow'
const resultPath =
  process.env.IRISOUT_LIFECYCLE_RESULT ?? '/tmp/irisout-lifecycle-control-flow.json'
const executablePath =
  process.env.IRISOUT_CHROMIUM_PATH ??
  process.env.CHROMIUM_PATH ??
  '/nix/store/g0yvxs8p2ijrvmxpd5mim1ni0fyk9bnh-chromium-154.0.8037.57/bin/chromium'

const sources = {
  main: `
export function App() {
  const value = signal(0);
  render(<div>
    <span id="value">{value()}</span>
    <canvas id="watch" use={watch}/>
    <canvas id="chosen" use={choose}/>
    <canvas id="guard" use={guard}/>
    <button id="advance" onClick={advance}>advance</button>
  </div>);
  onMount(() => {
    const label = 'first-' + globalThis.__lifecycleBrowser.branch;
    if (globalThis.__lifecycleBrowser.branch === 'a') {
      value(1);
      return () => { globalThis.__lifecycleBrowser.log.push(label); };
    }
    value(1);
    return () => { globalThis.__lifecycleBrowser.log.push(label); };
  });
  onMount(() => {
    let label = 'before';
    try { if (value() === 1) return () => { globalThis.__lifecycleBrowser.log.push(label); }; }
    finally { label = 'second-after'; value(2); }
  });
  onMount(() => { if (value() === 2) return; value(99); });
  function watch(el) { return {
    update() { globalThis.__lifecycleBrowser.log.push('watch-' + value()); },
    destroy() { globalThis.__lifecycleBrowser.log.push('destroy-watch'); }
  }; }
  function choose(el) {
    const branch = globalThis.__lifecycleBrowser.branch;
    let label = 'before';
    try {
      if (branch === 'a') return {
        update() { el.setAttribute('data-value', branch + ':' + label + ':' + value()); },
        destroy() { globalThis.__lifecycleBrowser.log.push('destroy-' + branch + ':' + label); }
      };
      return () => { el.setAttribute('data-value', branch + ':' + label + ':' + value()); };
    } finally { label = 'after'; }
  }
  function guard(el) { if (globalThis.__lifecycleBrowser.skip) return; value(99); }
  function advance() { value(value() + 1); }
}
`,
  failure: `
export function App() {
  const value = signal(0);
  render(<div><canvas use={watch}/><canvas use={failAction}/></div>);
  onMount(() => {
    if (globalThis.__lifecycleBrowser.branch === 'a') return () => { globalThis.__lifecycleBrowser.log.push('cleanup-first'); };
    return;
  });
  onMount(() => {
    if (globalThis.__lifecycleBrowser.branch === 'a') return () => { globalThis.__lifecycleBrowser.log.push('cleanup-second'); };
    return;
  });
  onMount(() => {
    try { value(1); throw globalThis.__lifecycleBrowser.failure; }
    finally { value(2); }
  });
  function watch(el) { return {
    update() { globalThis.__lifecycleBrowser.log.push('watch-' + value()); },
    destroy() { globalThis.__lifecycleBrowser.log.push('destroy-watch'); }
  }; }
  function failAction(el) {
    if (globalThis.__lifecycleBrowser.failureKind !== 'use') return;
    try { value(1); throw globalThis.__lifecycleBrowser.failure; }
    finally { value(2); }
  }
}
`,
  units: `
function Row({ item }) {
  render(<li key={item.id} use={setup}>{item.id}</li>);
  onMount(() => {
    const id = item.id;
    if (id === 1) return () => { globalThis.__lifecycleBrowser.log.push('mount-' + id); };
    return;
  });
  function setup(el) {
    const id = item.id;
    globalThis.__lifecycleBrowser.log.push('setup-' + id);
    return id === 1
      ? { destroy() { globalThis.__lifecycleBrowser.log.push('action-' + id); } }
      : { destroy() { globalThis.__lifecycleBrowser.log.push('other-' + id); } };
  }
}
export function App() {
  const items = signal([{ id: 1 }, { id: 2 }]);
  render(<div><button id="shuffle" onClick={shuffle}>shuffle</button><button id="remove" onClick={remove}>remove</button>
    <ul>{items().map(item => <Row key={item.id} item={item}/>)}</ul></div>);
  function shuffle() { items([{ id: 2 }, { id: 1 }]); }
  function remove() { items([{ id: 2 }]); }
}
`,
  effect: `
export function App() {
  const value = signal(0);
  const cleanupValue = signal(0);
  render(<div><canvas use={watch}/><button id="advance" onClick={advance}>advance</button>
    <button id="cleanup-value" onClick={advanceCleanup}>cleanup-value</button></div>);
  effect(() => {
    const current = value();
    globalThis.__lifecycleBrowser.log.push('effect-' + current);
    return current === 0
      ? () => { globalThis.__lifecycleBrowser.log.push('cleanup-zero-' + cleanupValue()); }
      : current === 1 ? undefined
      : () => { globalThis.__lifecycleBrowser.log.push('cleanup-' + current); };
  });
  function watch(el) {
    if (globalThis.__lifecycleBrowser.branch === 'a') return {
      update() { globalThis.__lifecycleBrowser.log.push('update-' + value()); },
      destroy() { globalThis.__lifecycleBrowser.log.push('destroy-' + cleanupValue()); }
    };
    return;
  }
  function advance() { value(value() + 1); }
  function advanceCleanup() { cleanupValue(cleanupValue() + 1); }
}
`,
  cleanupHelper: `
function Child({ write }) {
  render(<span>child</span>);
  onMount(() => {
    if (globalThis.__lifecycleBrowser.branch === 'a') return () => { write(); };
    return;
  });
}
export function App() {
  const value = signal(0);
  const visible = signal(true);
  render(<div><span id="value">{value()}</span><button id="hide" onClick={hide}>hide</button>{visible() && <Child write={write}/>}</div>);
  function write() { value(9); globalThis.__lifecycleBrowser.log.push('cleanup-write'); }
  function hide() { visible(false); }
}
`,
}

const result = {
  startedAt: new Date().toISOString(),
  command: 'bun fixtures/lifecycle-control-flow/verify.mjs',
  repoRoot,
  browser: executablePath,
  checks: [],
  pageErrors: [],
  pass: false,
}
let browser
let server
try {
  await mkdir(outputDirectory, { recursive: true })
  const bundles = new Map()
  const initialHtml = {}
  for (const [name, source] of Object.entries(sources)) {
    const directory = path.join(outputDirectory, name)
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'source.jsx'), source)
    const compiled = compile(source)
    initialHtml[name] = compiled.initialHtml
    await writeFile(path.join(directory, 'generated.js'), compiled.code)
    await writeFile(
      path.join(directory, 'compiledsource.html'),
      `<!doctype html><div id="app">${compiled.initialHtml}</div>`,
    )
    const build = await Bun.build({
      entrypoints: [path.join(directory, 'generated.js')],
      outdir: path.join(directory, 'bundled'),
      target: 'browser',
      format: 'esm',
      plugins: [
        {
          name: 'irisout-runtime-source',
          setup(builder) {
            builder.onResolve({ filter: /^irisout\/runtime$/ }, () => ({
              path: path.join(repoRoot, 'packages/runtime/src/index.ts'),
            }))
          },
        },
      ],
    })
    if (!build.success) throw new Error(build.logs.map(String).join('\n'))
    bundles.set(`/${name}.js`, await build.outputs[0].text())
  }
  const entry = `
import { createComponent as createMain } from '/main.js';
import { createComponent as createFailure } from '/failure.js';
import { createComponent as createUnits } from '/units.js';
import { createComponent as createEffect } from '/effect.js';
import { createComponent as createCleanupHelper } from '/cleanupHelper.js';
const factories = { main: createMain, failure: createFailure, units: createUnits, effect: createEffect, cleanupHelper: createCleanupHelper };
const initialHtml = ${JSON.stringify(initialHtml)};
window.__mountLifecycle = (kind, branch = 'a', mode = 'mount', failureKind = 'mount') => {
  if (window.__lifecycleBrowser?.instance) window.__lifecycleBrowser.instance.unmount();
  window.__lifecycleBrowser = { branch, skip: true, failureKind, log: [], failure: new Error('lifecycle failure') };
  const container = document.querySelector('#app');
  container.replaceChildren();
  const instance = factories[kind]();
  window.__lifecycleBrowser.instance = instance;
  try {
    if (mode === 'hydrate') { container.innerHTML = initialHtml[kind]; instance.hydrate(container); }
    else instance.mount(container);
    return { mounted: true };
  } catch (error) {
    return { mounted: false, message: error.message, original: error === window.__lifecycleBrowser.failure };
  }
};
window.__lifecycleReady = true;
`
  await writeFile(path.join(outputDirectory, 'browser-entry.js'), entry)
  bundles.set('/entry.js', entry)
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname
      if (bundles.has(pathname))
        return new Response(bundles.get(pathname), {
          headers: { 'content-type': 'text/javascript; charset=utf-8' },
        })
      if (pathname === '/')
        return new Response(
          '<!doctype html><meta charset="utf-8"><div id="app"></div><script type="module" src="/entry.js"></script>',
          {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          },
        )
      return new Response('not found', { status: 404 })
    },
  })
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  result.version = browser.version()
  const page = await browser.newPage()
  page.on('pageerror', (error) => result.pageErrors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.port}/`)
  await page.waitForFunction(() => window.__lifecycleReady === true)

  async function check(name, operation) {
    try {
      result.checks.push({ name, pass: true, evidence: await operation() })
    } catch (error) {
      result.checks.push({ name, pass: false, error: String(error), stack: error.stack })
    }
  }

  for (const mode of ['mount', 'hydrate']) {
    await check(`action_capture_and_guard_${mode}`, async () => {
      await page.evaluate((mode) => window.__mountLifecycle('main', 'a', mode), mode)
      const initial = await page.evaluate(() => ({
        value: document.querySelector('#value').textContent,
        chosen: document.querySelector('#chosen').getAttribute('data-value'),
        log: [...window.__lifecycleBrowser.log],
      }))
      assert.deepEqual(initial, {
        value: '2',
        chosen: 'a:after:2',
        log: ['watch-0', 'watch-1', 'watch-2'],
      })
      await page.locator('#advance').click()
      assert.equal(await page.locator('#chosen').getAttribute('data-value'), 'a:after:3')
      await page.evaluate(() => {
        window.__lifecycleBrowser.instance.unmount()
        window.__lifecycleBrowser.instance.unmount()
      })
      const log = await page.evaluate(() => [...window.__lifecycleBrowser.log])
      // 既存の破棄順序はaction群を先に処理し、onMount群をそれぞれ逆順で処理する。
      assert.deepEqual(log.slice(-4), [
        'destroy-a:after',
        'destroy-watch',
        'second-after',
        'first-a',
      ])
      return { initial, log }
    })
  }
  await check('alternate_action_return_branch', async () => {
    await page.evaluate(() => window.__mountLifecycle('main', 'b'))
    assert.equal(await page.locator('#chosen').getAttribute('data-value'), 'b:after:2')
    await page.evaluate(() => window.__lifecycleBrowser.instance.unmount())
    const log = await page.evaluate(() => [...window.__lifecycleBrowser.log])
    assert.deepEqual(log.slice(-3), ['destroy-watch', 'second-after', 'first-b'])
    assert.equal(log.filter((entry) => entry.startsWith('destroy-a:')).length, 0)
    return { log }
  })
  for (const failureKind of ['mount', 'use']) {
    await check(`${failureKind}_throw_finally_recovery`, async () => {
      const mounted = await page.evaluate(
        (kind) => window.__mountLifecycle('failure', 'a', 'mount', kind),
        failureKind,
      )
      assert.deepEqual(mounted, { mounted: false, message: 'lifecycle failure', original: true })
      const log = await page.evaluate(() => [...window.__lifecycleBrowser.log])
      assert.deepEqual(
        log,
        failureKind === 'mount'
          ? ['watch-0', 'watch-2', 'destroy-watch', 'cleanup-second', 'cleanup-first']
          : ['watch-0', 'watch-2', 'destroy-watch'],
      )
      assert.equal(await page.locator('#app').evaluate((element) => element.childElementCount), 0)
      await page.evaluate(() => window.__lifecycleBrowser.instance.unmount())
      assert.deepEqual(await page.evaluate(() => [...window.__lifecycleBrowser.log]), log)
      return { mounted, log }
    })
  }
  await check('keyed_unit_cleanup_ownership', async () => {
    await page.evaluate(() => window.__mountLifecycle('units'))
    await page.evaluate(() => {
      window.__originalRows = [...document.querySelectorAll('li')]
    })
    await page.locator('#shuffle').click()
    assert.equal(
      await page.evaluate(() => {
        const rows = document.querySelectorAll('li')
        return rows[0] === window.__originalRows[1] && rows[1] === window.__originalRows[0]
      }),
      true,
    )
    assert.deepEqual(await page.evaluate(() => [...window.__lifecycleBrowser.log]), [
      'setup-1',
      'setup-2',
    ])
    await page.locator('#remove').click()
    const removed = await page.evaluate(() => window.__lifecycleBrowser.log.slice(2).sort())
    assert.deepEqual(removed, ['action-1', 'mount-1'])
    await page.evaluate(() => {
      window.__lifecycleBrowser.instance.unmount()
      window.__lifecycleBrowser.instance.unmount()
    })
    const destroyed = await page.evaluate(() => window.__lifecycleBrowser.log.slice(2).sort())
    assert.deepEqual(destroyed, ['action-1', 'mount-1', 'other-2'])
    return { removed, destroyed }
  })
  await check('effect_branch_cleanup_and_read_dependencies', async () => {
    await page.evaluate(() => window.__mountLifecycle('effect'))
    const initial = await page.evaluate(() => [...window.__lifecycleBrowser.log])
    assert.deepEqual(initial, ['update-0', 'effect-0'])
    await page.locator('#cleanup-value').click()
    assert.deepEqual(await page.evaluate(() => [...window.__lifecycleBrowser.log]), initial)
    await page.locator('#advance').click()
    await page.locator('#advance').click()
    await page.evaluate(() => {
      window.__lifecycleBrowser.instance.unmount()
      window.__lifecycleBrowser.instance.unmount()
    })
    const log = await page.evaluate(() => [...window.__lifecycleBrowser.log])
    assert.deepEqual(
      log.filter((entry) => entry.startsWith('effect-') || entry.startsWith('cleanup-')),
      ['effect-0', 'cleanup-zero-1', 'effect-1', 'effect-2', 'cleanup-2'],
    )
    assert.equal(log.filter((entry) => entry === 'destroy-1').length, 1)
    return { initial, log }
  })
  await check('cleanup_helper_does_not_flush_root_dom', async () => {
    await page.evaluate(() => window.__mountLifecycle('cleanupHelper'))
    await page.locator('#hide').click()
    const evidence = await page.evaluate(() => ({
      value: document.querySelector('#value').textContent,
      log: [...window.__lifecycleBrowser.log],
    }))
    assert.deepEqual(evidence, { value: '0', log: ['cleanup-write'] })
    await page.screenshot({ path: path.join(outputDirectory, 'cleanup-helper.png') })
    await page.evaluate(() => window.__lifecycleBrowser.instance.unmount())
    return evidence
  })
  assert.deepEqual(result.pageErrors, [])
  result.pass = result.checks.length === 8 && result.checks.every((check) => check.pass)
} catch (error) {
  result.fatalError = String(error)
  result.stack = error.stack
} finally {
  if (browser) await browser.close()
  if (server) server.stop(true)
  result.finishedAt = new Date().toISOString()
  await writeFile(resultPath, JSON.stringify(result, null, 2) + '\n')
  console.log(
    JSON.stringify(
      { pass: result.pass, checks: result.checks, resultPath, fatalError: result.fatalError },
      null,
      2,
    ),
  )
  if (!result.pass) process.exitCode = 1
}
