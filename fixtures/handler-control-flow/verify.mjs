// 生成されたハンドラをChromiumで操作し、返り値・例外・非同期更新・解除を検証する。
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

function findRepoRoot() {
  if (process.env.IRISOUT_REPO_ROOT) return path.resolve(process.env.IRISOUT_REPO_ROOT)
  let directory = path.dirname(fileURLToPath(import.meta.url))
  while (true) {
    if (existsSync(path.join(directory, 'packages/compiler/src/compiler.ts'))) return directory
    const parent = path.dirname(directory)
    if (parent === directory) return process.cwd()
    directory = parent
  }
}

const repoRoot = findRepoRoot()
const { compile } = await import(
  pathToFileURL(path.join(repoRoot, 'packages/compiler/src/compiler.ts')).href
)
const benchRequire = createRequire(path.join(repoRoot, 'packages/bench/package.json'))
const playwright = await import(pathToFileURL(benchRequire.resolve('playwright')).href)
const { chromium } = playwright.default ?? playwright
const artifactDirectory =
  process.env.IRISOUT_HANDLER_BROWSER_ARTIFACTS ?? '/tmp/irisout-handler-browser-artifacts'
const resultPath = process.env.IRISOUT_HANDLER_BROWSER_RESULT ?? '/tmp/irisout-handler-browser.json'
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  process.env.IRISOUT_CHROMIUM_PATH ??
  process.env.CHROMIUM_PATH ??
  '/nix/store/g0yvxs8p2ijrvmxpd5mim1ni0fyk9bnh-chromium-154.0.8037.57/bin/chromium'
const result = {
  startedAt: new Date().toISOString(),
  browser: executablePath,
  repoRoot,
  command: 'bun fixtures/handler-control-flow/verify.mjs',
  checks: [],
  pageErrors: [],
  pass: false,
}

const source = `
export function App() {
  const value = signal(0);
  const guarded = signal(0);
  const listenerCount = signal(0);
  render(<div>
    <span id="value">{value()}</span>
    <span id="guarded">{guarded()}</span>
    <span id="listener-count">{listenerCount()}</span>
    <button id="helper" onClick={runHelper}>helper</button>
    <button id="return" onClick={runReturn}>return</button>
    <button id="guard" onClick={runGuard}>guard</button>
    <button id="throw" onClick={runThrow}>throw</button>
    <button id="listener" use={setupListener}>listener</button>
    <button id="async" onClick={runAsync}>async</button>
    <button id="callback" onClick={runCallback}>callback</button>
  </div>);
  effect(() => { globalThis.__handlerBrowser.guardEffects.push(guarded()); });
  function runHelper() { globalThis.__handlerBrowser.helperResult = write(2); }
  function write(next) { value(next); return next + 1; }
  function runReturn() { value(3); return 8; }
  function runGuard() { if (guarded() === 0) return; guarded(1); }
  function runThrow() { value(4); throw globalThis.__handlerBrowser.failure; }
  function setupListener(el) {
    const name = 'owned-listener';
    function onClick() {
      listenerCount(listenerCount() + 1);
      globalThis.__handlerBrowser.listenerCalls++;
      return 9;
    }
    el.addEventListener('click', onClick);
    return { destroy() {
      el.removeEventListener('click', onClick);
      globalThis.__handlerBrowser.destroyed.push(name);
    } };
  }
  function runAsync() { globalThis.__handlerBrowser.pending = load(); }
  async function load() {
    const next = await globalThis.__handlerBrowser.deferred;
    value(next);
    return next + 1;
  }
  function runCallback() { globalThis.__handlerBrowser.pending = loadCallback(); }
  function loadCallback() {
    return Promise.resolve(6).then(next => value(next)).then(next => {
      globalThis.__handlerBrowser.callbackResult = next;
      return next;
    });
  }
}
`

let browser
let server
try {
  await mkdir(artifactDirectory, { recursive: true })
  await writeFile(`${artifactDirectory}/source.jsx`, source)
  const compiled = compile(source)
  await writeFile(`${artifactDirectory}/generated.js`, compiled.code)
  await writeFile(
    `${artifactDirectory}/compiledsource.html`,
    `<!doctype html><meta charset="utf-8"><div id="app">${compiled.initialHtml}</div>`,
  )
  await writeFile(
    `${artifactDirectory}/entry.js`,
    `
import { mountComponent } from './generated.js';
window.__handlerBrowser = {
  guardEffects: [], helperResult: null, callbackResult: null, listenerCalls: 0,
  destroyed: [], observedErrors: [], failure: new Error('authored failure'), pending: null,
};
window.__handlerBrowser.deferred = new Promise(resolve => {
  window.__handlerBrowser.resolveDeferred = resolve;
});
window.addEventListener('error', event => {
  window.__handlerBrowser.observedErrors.push({
    message: event.error?.message,
    original: event.error === window.__handlerBrowser.failure,
  });
  event.preventDefault();
});
window.__handlerBrowser.instance = mountComponent(document.getElementById('app'));
window.__handlerBrowser.ready = true;
`,
  )
  const build = await Bun.build({
    entrypoints: [`${artifactDirectory}/entry.js`],
    outdir: `${artifactDirectory}/bundled`,
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
  const bundle = await build.outputs[0].text()
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname
      if (pathname === '/app.js')
        return new Response(bundle, {
          headers: { 'content-type': 'text/javascript; charset=utf-8' },
        })
      if (pathname === '/')
        return new Response(
          '<!doctype html><meta charset="utf-8"><div id="app"></div><script type="module" src="/app.js"></script>',
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
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
  await page.waitForFunction(() => window.__handlerBrowser?.ready === true)
  await page.screenshot({ path: `${artifactDirectory}/mounted.png` })

  async function check(name, operation) {
    try {
      const evidence = await operation()
      result.checks.push({ name, pass: true, evidence })
    } catch (error) {
      result.checks.push({ name, pass: false, error: String(error), stack: error.stack })
    }
  }

  await check('sync_helper_return', async () => {
    await page.locator('#helper').click()
    const evidence = await page.evaluate(() => ({
      value: document.querySelector('#value').textContent,
      returned: window.__handlerBrowser.helperResult,
    }))
    assert.deepEqual(evidence, { value: '2', returned: 3 })
    return evidence
  })
  await check('return_after_write', async () => {
    await page.locator('#return').click()
    const value = await page.locator('#value').textContent()
    assert.equal(value, '3')
    return { value }
  })
  await check('guard_return_does_not_rerun_effect', async () => {
    const before = await page.evaluate(() => [...window.__handlerBrowser.guardEffects])
    assert.deepEqual(before, [0])
    await page.locator('#guard').click()
    const after = await page.evaluate(() => [...window.__handlerBrowser.guardEffects])
    assert.deepEqual(after, before)
    assert.equal(await page.locator('#guarded').textContent(), '0')
    return { before, after }
  })
  await check('throw_updates_dom_and_preserves_error', async () => {
    await page.locator('#throw').click()
    const evidence = await page.evaluate(() => ({
      value: document.querySelector('#value').textContent,
      errors: window.__handlerBrowser.observedErrors,
    }))
    assert.deepEqual(evidence, {
      value: '4',
      errors: [{ message: 'authored failure', original: true }],
    })
    return evidence
  })
  await check('local_function_action_listener', async () => {
    await page.locator('#listener').click()
    const evidence = await page.evaluate(() => ({
      value: document.querySelector('#listener-count').textContent,
      calls: window.__handlerBrowser.listenerCalls,
    }))
    assert.deepEqual(evidence, { value: '1', calls: 1 })
    return evidence
  })
  await check('async_helper_completion', async () => {
    const before = await page.locator('#value').textContent()
    await page.locator('#async').click()
    const pendingValue = await page.locator('#value').textContent()
    assert.equal(pendingValue, before)
    const returned = await page.evaluate(async () => {
      window.__handlerBrowser.resolveDeferred(5)
      return await window.__handlerBrowser.pending
    })
    const value = await page.locator('#value').textContent()
    assert.equal(value, '5')
    assert.equal(returned, 6)
    return { before, pendingValue, value, returned }
  })
  await check('helper_promise_callback_return_and_update', async () => {
    await page.locator('#callback').click()
    await page.evaluate(async () => await window.__handlerBrowser.pending)
    const evidence = await page.evaluate(() => ({
      value: document.querySelector('#value').textContent,
      returned: window.__handlerBrowser.callbackResult,
    }))
    assert.deepEqual(evidence, { value: '6', returned: 6 })
    return evidence
  })
  await check('unmount_removes_action_listener', async () => {
    const evidence = await page.evaluate(() => {
      const target = document.querySelector('#listener')
      const before = window.__handlerBrowser.listenerCalls
      window.__handlerBrowser.instance.unmount()
      target.dispatchEvent(new Event('click', { bubbles: true }))
      window.__handlerBrowser.instance.unmount()
      return {
        before,
        after: window.__handlerBrowser.listenerCalls,
        destroyed: window.__handlerBrowser.destroyed,
      }
    })
    assert.deepEqual(evidence, { before: 1, after: 1, destroyed: ['owned-listener'] })
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
