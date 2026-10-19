// 実装ソースを読まずに、HTTPと画面から障害対応ボードの8項目を検査する。
// 同じ文書での監視解除を観測し、API更新には起動直後のサーバーを使う。
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const require = createRequire(new URL('../../packages/bench/package.json', import.meta.url))
const { chromium } = require('playwright')

const base = process.env.DOGFOOD_BASE_URL
if (!base) throw new Error('DOGFOOD_BASE_URLが必要です')
const root =
  process.env.DOGFOOD_ARTIFACT_DIR || path.join(tmpdir(), 'irisout-incident-dogfood-check')
const output = process.env.DOGFOOD_RESULT_PATH || `${root}/result.json`
const feedback = process.env.DOGFOOD_FEEDBACK_PATH || `${root}/feedback.md`
const results = []
const contexts = []
const observations = []
const startedAt = new Date().toISOString()
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  headless: true,
})

function check(condition, message) {
  if (!condition) throw new Error(message)
}
async function http(path, options) {
  const response = await fetch(new URL(path, base), options)
  const body = await response.text()
  return { status: response.status, body }
}
async function setup(options = {}, instrument = false) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options })
  context.setDefaultTimeout(10000)
  contexts.push(context)
  if (instrument)
    await context.addInitScript(() => {
      const originalAdd = window.addEventListener
      const originalRemove = window.removeEventListener
      const registrations = []
      window.__incidentVerify = { registrations, events: [] }
      window.addEventListener = function (type, listener, options) {
        if (type === 'incident-ping' && listener) {
          const capture = typeof options === 'boolean' ? options : !!options?.capture
          if (!registrations.some((item) => item.listener === listener && item.capture === capture))
            registrations.push({ listener, capture })
          window.__incidentVerify.events.push({ action: 'add', count: registrations.length })
        }
        return originalAdd.call(this, type, listener, options)
      }
      window.removeEventListener = function (type, listener, options) {
        if (type === 'incident-ping' && listener) {
          const capture = typeof options === 'boolean' ? options : !!options?.capture
          const index = registrations.findIndex(
            (item) => item.listener === listener && item.capture === capture,
          )
          if (index !== -1) registrations.splice(index, 1)
          window.__incidentVerify.events.push({ action: 'remove', count: registrations.length })
        }
        return originalRemove.call(this, type, listener, options)
      }
    })
  const page = await context.newPage()
  page.on('pageerror', (error) => observations.push({ kind: 'pageerror', message: error.message }))
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    document.__incidentVerifyMark = Math.random().toString(36).slice(2)
  })
  return page
}
async function mark(page) {
  return page.evaluate(() => document.__incidentVerifyMark)
}
async function navigate(page, locator, pathname) {
  const before = await mark(page)
  await locator.click()
  await page.waitForURL((url) => url.pathname === pathname)
  await page.waitForTimeout(150)
  check((await mark(page)) === before, `「${pathname}」へのリンクで文書全体が再読み込みされました`)
}
async function detail(page, id) {
  const link = page.locator(`a[href="/incidents/${id}"]`).first()
  check((await link.count()) > 0, `詳細リンク /incidents/${id} が画面にありません`)
  check(
    /詳細/.test(await link.innerText()),
    `詳細リンク /incidents/${id} の名前に「詳細」がありません`,
  )
  await navigate(page, link, `/incidents/${id}`)
}
async function home(page) {
  const link = page.locator('a[href="/"]').first()
  check((await link.count()) > 0, '一覧へ戻るリンクが画面にありません')
  await navigate(page, link, '/')
  await page.getByLabel('検索', { exact: true }).waitFor()
}
async function received(page) {
  const output = page.getByLabel('受信数', { exact: true })
  if ((await output.count()) === 1) return (await output.textContent()).trim()
  return (await page.locator('body').innerText()).match(/受信数\s*[:：]\s*(\d+)\b/)?.[1]
}
async function verify(number, name, action) {
  const entry = { number, name, passed: false, observations: [] }
  results.push(entry)
  const pagesBefore = contexts.flatMap((context) => context.pages())
  try {
    await action(entry.observations)
    entry.passed = true
  } catch (error) {
    entry.failure = error.message
    const pages = contexts
      .flatMap((context) => context.pages())
      .filter((page) => !pagesBefore.includes(page))
    for (const [index, page] of pages.entries()) {
      try {
        entry.observations.push({
          url: page.url(),
          body: (await page.locator('body').innerText()).slice(0, 4000),
        })
        const path = `${root}/failure-${number}-${index}.png`
        await page.screenshot({ path, fullPage: true })
        entry.observations.push({ screenshot: path })
      } catch {}
    }
  }
  console.log(JSON.stringify(entry))
  await writeFile(output, JSON.stringify({ startedAt, base, results, observations }, null, 2))
}

try {
  await mkdir(root, { recursive: true })
  await verify(1, 'JavaScript無効の初期HTMLと詳細件名', async (notes) => {
    for (const { path, titles } of [
      { path: '/', titles: ['決済API停止', '通知遅延', '検索障害'] },
      { path: '/incidents/i1', titles: ['決済API停止'] },
    ]) {
      const response = await http(path)
      check(response.status === 200, `${path} HTTP ${response.status}`)
      for (const title of titles)
        check(response.body.includes(title), `${path} の初期HTMLに「${title}」がありません`)
      notes.push({ path, status: response.status, titles })
    }
    const context = await browser.newContext({ javaScriptEnabled: false })
    contexts.push(context)
    const page = await context.newPage()
    await page.goto(base)
    for (const title of ['決済API停止', '通知遅延', '検索障害'])
      check(
        (await page.locator('body').innerText()).includes(title),
        `JavaScript無効の一覧で「${title}」が見えません`,
      )
    await page.goto(new URL('/incidents/i1', base).href)
    check(
      (await page.locator('body').innerText()).includes('決済API停止'),
      'JavaScript無効の詳細で件名が見えません',
    )
  })
  await verify(2, '初期API・検索遅延・未知ID404', async (notes) => {
    const response = await http('/api/incidents')
    const unknown = await http('/incidents/unknown-verifier-id')
    notes.push({ initial: response, unknown })
    check(response.status === 200, `初期API HTTP ${response.status}`)
    JSON.parse(response.body)
    for (const term of ['i1', 'i2', 'i3', '決済API停止', '通知遅延', '検索障害'])
      check(response.body.includes(term), `初期APIに「${term}」がありません`)
    check(unknown.status === 404, `未知IDの詳細がHTTP ${unknown.status}です`)
    const timings = await Promise.all(
      ['決済', '通知'].map(async (q) => {
        const start = performance.now()
        const r = await http(`/api/incidents?q=${encodeURIComponent(q)}`)
        return { q, elapsedMs: Math.round(performance.now() - start), ...r }
      }),
    )
    notes.push({ timings })
    check(timings[0].elapsedMs >= 550, `決済のAPI応答が${timings[0].elapsedMs}msでした`)
    check(timings[1].elapsedMs < 450, `通知のAPI応答が${timings[1].elapsedMs}msでした`)
    for (const timing of timings)
      check(timing.status === 200, `${timing.q}検索 HTTP ${timing.status}`)
  })
  await verify(3, '検索応答の競合', async (notes) => {
    const page = await setup()
    const search = page.getByLabel('検索', { exact: true })
    const slowRequest = page.waitForRequest(
      (r) =>
        new URL(r.url()).pathname === '/api/incidents' &&
        new URL(r.url()).searchParams.get('q') === '決済',
    )
    await search.fill('決済')
    await slowRequest
    await search.fill('通知')
    await page.waitForTimeout(850)
    const body = await page.locator('body').innerText()
    notes.push({ body })
    check(body.includes('通知遅延'), '競合後に「通知遅延」がありません')
    check(
      !body.includes('決済API停止') && !body.includes('検索障害'),
      '競合後に通知以外の障害が表示されています',
    )
  })
  await verify(4, 'HTTP503の表示と次の検索による回復', async (notes) => {
    const failure = await http('/api/incidents?q=%E5%A4%B1%E6%95%97')
    notes.push({ api: failure })
    const page = await setup()
    const search = page.getByLabel('検索', { exact: true })
    await search.fill('失敗')
    await page.waitForTimeout(250)
    const failedBody = await page.locator('body').innerText()
    check(
      /失敗|エラー|取得でき|検索でき|503/.test(failedBody),
      '失敗検索後にエラーの通知がありません',
    )
    await search.fill('通知')
    await page.waitForTimeout(250)
    const recoveredBody = await page.locator('body').innerText()
    notes.push({ failedBody, recoveredBody })
    check(failure.status === 503, `失敗検索APIがHTTP ${failure.status}です`)
    check(recoveredBody.includes('通知遅延'), '503後の通知検索が回復しません')
    check(
      !/失敗|エラー|取得でき|検索でき|503/.test(recoveredBody),
      '回復後もエラー通知が残っています',
    )
    check(
      !recoveredBody.includes('決済API停止') && !recoveredBody.includes('検索障害'),
      '回復後の一覧に通知以外が残っています',
    )
  })
  await verify(5, '解決APIと一覧・再読み込みへの反映', async (notes) => {
    const page = await setup()
    await detail(page, 'i1')
    await page.getByRole('button', { name: '解決する', exact: true }).click()
    await page.getByText('解決済み', { exact: true }).first().waitFor()
    notes.push({ detail: await page.locator('body').innerText() })
    await home(page)
    const item = page
      .locator('li, article, tr')
      .filter({ has: page.locator('a[href="/incidents/i1"]') })
      .first()
    check((await item.count()) > 0, '決済API停止の一覧項目を操作可能な項目として特定できません')
    check((await item.innerText()).includes('解決済み'), '一覧に解決済みが反映されません')
    await page.reload({ waitUntil: 'networkidle' })
    check((await item.innerText()).includes('解決済み'), '一覧の再読み込み後に解決済みが消えました')
    const api = await http('/api/incidents?q=%E6%B1%BA%E6%B8%88')
    notes.push({ list: await page.locator('body').innerText(), api })
    check(api.status === 200, `更新後API HTTP ${api.status}`)
    await page.goto(new URL('/incidents/i1', base).href)
    check(
      (await page.locator('body').innerText()).includes('解決済み'),
      '詳細の再読み込み後に解決済みが消えました',
    )
  })
  await verify(6, 'ID別メモの分離と遷移・再読み込み保持', async (notes) => {
    const page = await setup()
    const memoA = '検査i1：決済担当への連絡'
    const memoB = '検査i2：通知の再送'
    await detail(page, 'i1')
    await page.getByLabel('作業メモ', { exact: true }).fill(memoA)
    await home(page)
    await detail(page, 'i2')
    check(
      (await page.getByLabel('作業メモ', { exact: true }).inputValue()) !== memoA,
      'i1の作業メモがi2へ混入しました',
    )
    await page.getByLabel('作業メモ', { exact: true }).fill(memoB)
    await home(page)
    await detail(page, 'i1')
    check(
      (await page.getByLabel('作業メモ', { exact: true }).inputValue()) === memoA,
      '一覧・別IDへの遷移後にi1のメモが保持されません',
    )
    await page.reload({ waitUntil: 'networkidle' })
    check(
      (await page.getByLabel('作業メモ', { exact: true }).inputValue()) === memoA,
      '再読み込み後にi1のメモが保持されません',
    )
    await page.goto(new URL('/incidents/i2', base).href, { waitUntil: 'networkidle' })
    check(
      (await page.getByLabel('作業メモ', { exact: true }).inputValue()) === memoB,
      '別IDの再読み込み後にi2のメモが保持されません',
    )
    notes.push({ memoA, memoB, storedKeys: await page.evaluate(() => Object.keys(localStorage)) })
  })
  await verify(7, '同一文書で監視登録1→0→1と受信表示', async (notes) => {
    const page = await setup({}, true)
    const active = () => page.evaluate(() => window.__incidentVerify.registrations.length)
    const counts = [await active()]
    check(counts[0] === 0, `初期一覧で監視が${counts[0]}件あります`)
    await detail(page, 'i1')
    counts.push(await active())
    check(counts.at(-1) === 1, `詳細で監視が${counts.at(-1)}件です`)
    check(
      (await page.locator('body').innerText()).includes('監視中'),
      '詳細に「監視中」の段落がありません',
    )
    const before = await received(page)
    await page.evaluate(() => window.dispatchEvent(new Event('incident-ping')))
    await page.waitForTimeout(100)
    const after = await received(page)
    check(before === '0', '詳細の受信数が0から始まりません')
    check(after === '1', 'incident-ping1回の受信数が1になりません')
    await home(page)
    counts.push(await active())
    check(counts.at(-1) === 0, `一覧に戻っても監視が${counts.at(-1)}件残っています`)
    await detail(page, 'i2')
    counts.push(await active())
    check(counts.at(-1) === 1, `詳細に入り直すと監視が${counts.at(-1)}件です`)
    await home(page)
    counts.push(await active())
    await detail(page, 'i1')
    counts.push(await active())
    check(counts.at(-2) === 0 && counts.at(-1) === 1, '詳細と一覧の反復で監視が蓄積しています')
    await home(page)
    counts.push(await active())
    check(counts.at(-1) === 0, '最後に一覧へ戻っても監視が残っています')
    notes.push({
      counts,
      before,
      after,
      events: await page.evaluate(() => window.__incidentVerify.events),
    })
  })
  await verify(8, '検索要求中の詳細遷移とキーボード操作', async (notes) => {
    const page = await setup()
    const searchResponses = []
    page.on('response', (response) => {
      const url = new URL(response.url())
      if (url.pathname === '/api/incidents' && url.searchParams.get('q') === '決済')
        searchResponses.push(response.status())
    })
    const search = page.getByLabel('検索', { exact: true })
    const pending = page.waitForRequest(
      (r) =>
        new URL(r.url()).pathname === '/api/incidents' &&
        new URL(r.url()).searchParams.get('q') === '決済',
    )
    await search.focus()
    await page.keyboard.type('決済')
    await pending
    const requestObservedAt = performance.now()
    const pendingBeforeNavigation = searchResponses.length === 0
    const link = page.locator('a[href="/incidents/i1"]').first()
    const before = await mark(page)
    await link.focus()
    check(
      await link.evaluate((element) => element === document.activeElement),
      '詳細リンクをキーボードで選択できません',
    )
    await page.keyboard.press('Enter')
    await page.waitForURL((url) => url.pathname === '/incidents/i1')
    const pendingAfterNavigation = searchResponses.length === 0
    const navigationAfterRequestMs = Math.round(performance.now() - requestObservedAt)
    check((await mark(page)) === before, '検索中の詳細遷移で文書全体が再読み込みされました')
    await page.waitForTimeout(900)
    const body = await page.locator('body').innerText()
    notes.push({
      body,
      url: page.url(),
      searchResponses,
      pendingBeforeNavigation,
      pendingAfterNavigation,
      navigationAfterRequestMs,
    })
    check(
      pendingBeforeNavigation && pendingAfterNavigation,
      '詳細への遷移前または遷移直後に検索応答が完了していました',
    )
    check(
      !searchResponses.some((status) => status !== 200),
      `検索APIがHTTP ${searchResponses.join(', ')}のため600ms応答中の遷移は未確認です`,
    )
    check(new URL(page.url()).pathname === '/incidents/i1', '検索応答により詳細URLが変わりました')
    check(body.includes('決済API停止'), '検索応答後に詳細の件名がありません')
    check(
      await page.getByLabel('作業メモ', { exact: true }).isVisible(),
      '検索応答が詳細画面を書き換えました',
    )
    check(
      (await page.getByLabel('検索', { exact: true }).count()) === 0,
      '検索応答後に一覧の検索入力が詳細へ出現しました',
    )
  })
} finally {
  await browser.close()
  const completedAt = new Date().toISOString()
  const report = {
    startedAt,
    completedAt,
    base,
    passed:
      results.length === 8 && results.every((result) => result.passed) && observations.length === 0,
    results,
    observations,
  }
  await writeFile(output, JSON.stringify(report, null, 2))
  const failures = results.filter((result) => !result.passed)
  await writeFile(
    feedback,
    '# 障害対応ボードの操作検査\n\n' +
      `検査開始: ${startedAt}。画面とHTTPのみを確認し、実装ソースは読んでいません。\n\n` +
      (failures.length
        ? failures
            .map(
              (result) =>
                `## ${result.number}. ${result.name}\n\n観測: ${result.failure}\n\n画面の原文: \n\n\`\`\`\n${result.observations
                  .filter((o) => o.body)
                  .map((o) => o.body)
                  .join('\n')}\n\`\`\`\n`,
            )
            .join('\n')
        : '8項目の操作検査で不合格はありませんでした。\n') +
      `\nブラウザー例外: ${JSON.stringify(observations)}\n`,
  )
  process.exitCode = report.passed ? 0 : 1
  console.log(
    JSON.stringify({
      output,
      feedback,
      passed: report.passed,
      summary: results.map((r) => ({ number: r.number, passed: r.passed, failure: r.failure })),
    }),
  )
}
