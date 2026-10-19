// 関数値の別名・引数・返却と内部名の衝突を、Chromiumのmount/hydrateで検証する。
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { compile } from '../../packages/compiler/src/compiler.ts'

const root = path.resolve(import.meta.dirname, '../..')
const require = createRequire(path.join(root, 'packages/bench/package.json'))
const { chromium } = await import(pathToFileURL(require.resolve('playwright')).href)
const artifacts =
  process.env.IRISOUT_BOUNDARY_ARTIFACTS ?? '/tmp/irisout-javascript-boundaries-browser'
const resultPath =
  process.env.IRISOUT_BOUNDARY_BROWSER_RESULT ?? '/tmp/irisout-javascript-boundaries-browser.json'
const executablePath =
  process.env.IRISOUT_CHROMIUM_PATH ??
  '/nix/store/g0yvxs8p2ijrvmxpd5mim1ni0fyk9bnh-chromium-154.0.8037.57/bin/chromium'
const source = `
export function App() {
  const count = signal(0);
  const visible = signal(true);
  render(<main><span id="count" use={setup}>{count()}</span>
    <button id="step" onClick={run}>step</button><button id="async" onClick={runAsync}>async</button>
    <button id="hide" onClick={() => visible(false)}>hide</button>{visible() && <Child cleanup={writeCleanup}/>}</main>);
  onMount(() => { const cleanup = () => globalThis.__boundaryLog.push('mount-cleanup'); return cleanup; });
  effect(() => {
    function invoke(fn) { return fn(); }
    function read() { return count(); }
    const alias = read;
    globalThis.__boundaryLog.push('effect:' + invoke(alias));
    const label = 'effect-cleanup:' + invoke(alias);
    const cleanup = () => globalThis.__boundaryLog.push(label);
    return cleanup;
  });
  function setup(element) {
    function read() { return count(); }
    function invoke(fn) { return fn(); }
    const update = () => { element.dataset.value = String(invoke(read)); };
    const destroy = () => globalThis.__boundaryLog.push('action-destroy');
    return {update, destroy};
  }
  function run(__markers__) {
    function invoke(fn) { return fn(); }
    const alias = __container__;
    globalThis.__boundaryLog.push(alias.name + ':' + alias.length);
    invoke(alias);
  }
  function __container__() { count(count() + 1); }
  function runAsync() { function invoke(fn) { fn(); } const alias = later; invoke(alias); }
  async function later() { await Promise.resolve(); count(2); }
  function writeCleanup() { count(9); Promise.resolve().then(() => count(10)); globalThis.__boundaryLog.push('child-cleanup'); }
}
function Child({cleanup}) {
  render(<p id="child">child</p>);
  onMount(() => {
    function invoke(fn) { fn(); }
    const alias = cleanup;
    const destroy = () => invoke(alias);
    return destroy;
  });
}
`
const result = { date: '2026-10-19', checks: [], pageErrors: [], pass: false }
let server
let browser
try {
  await mkdir(artifacts, { recursive: true })
  const compiled = compile(source)
  const entryPath = path.join(artifacts, 'entry.js')
  await writeFile(path.join(artifacts, 'source.jsx'), source)
  await writeFile(path.join(artifacts, 'generated.js'), compiled.code)
  await writeFile(
    entryPath,
    compiled.code +
      `
window.__boundaryMount = (mode) => {
  window.__boundaryInstance?.unmount();
  window.__boundaryLog = [];
  const element = document.querySelector('#app');
  const instance = createComponent();
  window.__boundaryInstance = instance;
  if (mode === 'hydrate') { element.innerHTML = ${JSON.stringify(compiled.initialHtml)}; instance.hydrate(element); }
  else instance.mount(element);
};
window.__boundaryReady = true;`,
  )
  const bundle = await Bun.build({
    entrypoints: [entryPath],
    target: 'browser',
    format: 'esm',
    plugins: [
      {
        name: 'runtime-source',
        setup(builder) {
          builder.onResolve({ filter: /^irisout\/runtime$/ }, () => ({
            path: path.join(root, 'packages/runtime/src/index.ts'),
          }))
        },
      },
    ],
  })
  if (!bundle.success) throw new Error(bundle.logs.map(String).join('\n'))
  const javascript = await bundle.outputs[0].text()
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      return new URL(request.url).pathname === '/entry.js'
        ? new Response(javascript, { headers: { 'content-type': 'text/javascript' } })
        : new Response(
            '<!doctype html><meta charset="utf-8"><div id="app"></div><script type="module" src="/entry.js"></script>',
            { headers: { 'content-type': 'text/html' } },
          )
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
  await page.goto(`http://127.0.0.1:${server.port}`)
  await page.waitForFunction(() => window.__boundaryReady)
  for (const mode of ['mount', 'hydrate']) {
    await page.evaluate((mode) => window.__boundaryMount(mode), mode)
    assert.equal(await page.locator('#count').textContent(), '0')
    await page.locator('#step').click()
    assert.equal(await page.locator('#count').textContent(), '1')
    assert.equal(await page.locator('#count').getAttribute('data-value'), '1')
    await page.locator('#async').click()
    await page.waitForFunction(() => document.querySelector('#count').textContent === '2')
    await page.locator('#hide').click()
    await page.evaluate(() => Promise.resolve())
    assert.equal(await page.locator('#child').count(), 0)
    assert.equal(await page.locator('#count').textContent(), '2')
    assert.equal(await page.locator('#count').getAttribute('data-value'), '2')
    const before = await page.evaluate(() => [...window.__boundaryLog])
    assert.deepEqual(before, [
      'effect:0',
      '__container__:0',
      'effect-cleanup:0',
      'effect:1',
      'effect-cleanup:1',
      'effect:2',
      'child-cleanup',
    ])
    await page.screenshot({ path: path.join(artifacts, `${mode}.png`) })
    await page.evaluate(() => {
      window.__boundaryInstance.unmount()
      window.__boundaryInstance.unmount()
    })
    const after = await page.evaluate(() => [...window.__boundaryLog])
    // 種類の異なる所有者間の総順序は要求せず、それぞれ一度だけの破棄を確認する。
    assert.deepEqual(after.slice(before.length).sort(), [
      'action-destroy',
      'effect-cleanup:2',
      'mount-cleanup',
    ])
    result.checks.push({ mode, pass: true, before, after })
  }
  assert.deepEqual(result.pageErrors, [])
  result.pass = true
} catch (error) {
  result.error = String(error)
  result.stack = error.stack
} finally {
  await browser?.close()
  server?.stop(true)
  await writeFile(resultPath, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
  if (!result.pass) process.exitCode = 1
}
