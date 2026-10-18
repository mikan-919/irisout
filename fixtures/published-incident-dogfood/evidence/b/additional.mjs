// 実装は読まず、HTTPと画面から追加確認する。
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
const require = createRequire(new URL('../../../../packages/bench/package.json', import.meta.url))
const { chromium } = require('playwright')
const base = process.env.DOGFOOD_BASE_URL
if (!base) throw new Error('DOGFOOD_BASE_URLが必要です')
const out =
  process.env.DOGFOOD_ARTIFACT_DIR ?? path.join(tmpdir(), 'irisout-published-incident-additional-b')
const results = []
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
})
const check = (yes, text) => {
  if (!yes) throw new Error(text)
}
const body = (page) => page.locator('body').innerText()
const http = async (path, options) => {
  const start = performance.now()
  const response = await fetch(base + path, options)
  return {
    status: response.status,
    body: await response.text(),
    elapsedMs: Math.round(performance.now() - start),
  }
}
async function test(number, name, fn) {
  const record = { number, name, passed: false }
  try {
    record.evidence = await fn()
    record.passed = true
  } catch (e) {
    record.failure = e.message
  }
  results.push(record)
  console.log(JSON.stringify(record))
  await writeFile(out + '/additional-result.json', JSON.stringify({ base, results }, null, 2))
}
async function tabTo(page, locator) {
  for (let count = 0; count < 20; count++) {
    if (await locator.evaluate((el) => document.activeElement === el)) return count
    await page.keyboard.press('Tab')
  }
  throw new Error('Tabキーで対象へ移動できません')
}
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await context.addInitScript(() => {
  const add = window.addEventListener
  const remove = window.removeEventListener
  const active = []
  window.__operator = { active, changes: [], marker: Math.random() }
  window.addEventListener = function (type, listener, options) {
    if (type === 'incident-ping') {
      const capture = typeof options === 'boolean' ? options : !!options?.capture
      if (!active.some((x) => x.listener === listener && x.capture === capture))
        active.push({ listener, capture })
      window.__operator.changes.push({ action: 'add', count: active.length })
    }
    return add.call(this, type, listener, options)
  }
  window.removeEventListener = function (type, listener, options) {
    if (type === 'incident-ping') {
      const capture = typeof options === 'boolean' ? options : !!options?.capture
      const i = active.findIndex((x) => x.listener === listener && x.capture === capture)
      if (i >= 0) active.splice(i, 1)
      window.__operator.changes.push({ action: 'remove', count: active.length })
    }
    return remove.call(this, type, listener, options)
  }
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await mkdir(out, { recursive: true })
try {
  await test(1, 'JavaScriptなしの一覧・全詳細の件名', async () => {
    const noJS = await browser.newContext({ javaScriptEnabled: false })
    const p = await noJS.newPage()
    const evidence = []
    for (const [path, titles] of [
      ['/', ['決済API停止', '通知遅延', '検索障害']],
      ['/incidents/i1', ['決済API停止']],
      ['/incidents/i2', ['通知遅延']],
      ['/incidents/i3', ['検索障害']],
    ]) {
      const response = await p.goto(base + path)
      const text = await body(p)
      check(
        response.status() === 200 && titles.every((title) => text.includes(title)),
        path + 'の件名が表示されません',
      )
      evidence.push({ path, status: response.status(), body: text })
    }
    await noJS.close()
    return evidence
  })
  await test(2, 'APIの初期3件と未知ID404', async () => {
    const initial = await http('/api/incidents')
    const unknown = await http('/incidents/operator-unknown-20261018')
    const data = JSON.parse(initial.body)
    check(
      initial.status === 200 && data.length === 3 && data.map((x) => x.id).join(',') === 'i1,i2,i3',
      '3件の初期データがありません',
    )
    check(unknown.status === 404, '未知IDが404ではありません')
    return { initial, unknown }
  })
  await test(3, 'Tab検索で古い200応答を排除', async () => {
    await page.goto(base, { waitUntil: 'networkidle' })
    const search = page.getByLabel('検索', { exact: true })
    const controls = {
      links: await page
        .getByRole('link')
        .evaluateAll((els) =>
          els.map((el) => ({ name: el.textContent, href: el.getAttribute('href') })),
        ),
      titleElements: await page.getByText('決済API停止', { exact: true }).evaluateAll((els) =>
        els.map((el) => ({
          tag: el.tagName,
          role: el.getAttribute('role'),
          parentTag: el.parentElement.tagName,
        })),
      ),
      search: await search.evaluate((el) => ({
        tag: el.tagName,
        type: el.type,
        label: el.labels[0].textContent,
      })),
    }
    const tabs = await tabTo(page, search)
    const slowResponse = page.waitForResponse(
      (r) => new URL(r.url()).searchParams.get('q') === '決済',
    )
    const slowRequest = page.waitForRequest(
      (r) => new URL(r.url()).searchParams.get('q') === '決済',
    )
    await page.keyboard.type('決済')
    await slowRequest
    await page.keyboard.press('ControlOrMeta+A')
    const fastResponse = page.waitForResponse(
      (r) => new URL(r.url()).searchParams.get('q') === '通知',
    )
    await page.keyboard.type('通知')
    const fast = await fastResponse
    const fastAt = Date.now()
    await fast.finished()
    const slow = await slowResponse
    const slowAt = Date.now()
    await slow.finished()
    await page.waitForTimeout(100)
    const text = await body(page)
    check(
      fast.status() === 200 && slow.status() === 200 && slowAt > fastAt,
      '通知の後に決済200が返る順序を観測できません',
    )
    check(
      text.includes('通知遅延') && !text.includes('決済API停止') && !text.includes('検索障害'),
      '古い応答が一覧へ反映されました',
    )
    await page.screenshot({ path: out + '/search-race.png', fullPage: true })
    return {
      controls,
      tabs,
      fastStatus: fast.status(),
      slowStatus: slow.status(),
      slowAfterFastMs: slowAt - fastAt,
      body: text,
    }
  })
  await test(4, '503時の失敗表示と完了表示の矛盾なし・回復', async () => {
    const search = page.getByLabel('検索', { exact: true })
    await search.focus()
    await page.keyboard.press('ControlOrMeta+A')
    const failureResponse = page.waitForResponse(
      (r) => new URL(r.url()).searchParams.get('q') === '失敗',
    )
    await page.keyboard.type('失敗')
    const response = await failureResponse
    await response.finished()
    await page.waitForTimeout(100)
    const failed = await body(page)
    const failedStatus = await page.getByRole('status').innerText()
    check(
      response.status() === 503 && /失敗|エラー/.test(failedStatus),
      '503の失敗通知がありません',
    )
    check(!/完了|成功|更新しました/.test(failedStatus), '503と完了表示が矛盾します')
    await page.screenshot({ path: out + '/search-503.png', fullPage: true })
    await search.focus()
    await page.keyboard.press('ControlOrMeta+A')
    const recoveryResponse = page.waitForResponse(
      (r) => new URL(r.url()).searchParams.get('q') === '通知',
    )
    await page.keyboard.type('通知')
    await (await recoveryResponse).finished()
    await page.waitForTimeout(100)
    const recovered = await body(page)
    check(
      recovered.includes('通知遅延') && !/失敗|エラー|503|決済API停止|検索障害/.test(recovered),
      '失敗後に回復しません',
    )
    return { status: response.status(), failedStatus, failed, recovered }
  })
  await test(5, 'Enterで詳細へ遷移・Spaceで解決・一覧と再読み込みへ保存', async () => {
    const link = page.getByRole('link', { name: '詳細', exact: true })
    const linkTabs = await tabTo(page, link)
    const marker = await page.evaluate(() => window.__operator.marker)
    await page.keyboard.press('Enter')
    await page.waitForURL('**/incidents/i2')
    await page.getByLabel('作業メモ', { exact: true }).waitFor()
    check(
      (await page.evaluate(() => window.__operator.marker)) === marker,
      'リンクで文書全体が再読み込みされました',
    )
    const button = page.getByRole('button', { name: '解決する', exact: true })
    const buttonTabs = await tabTo(page, button)
    const resolveResponse = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/incidents/i2/resolve',
    )
    await page.keyboard.press('Space')
    const response = await resolveResponse
    await response.finished()
    await page.getByText('解決済み', { exact: true }).waitFor()
    const detail = await body(page)
    check(response.status() === 200 && detail.includes('解決済み'), 'Spaceで解決できません')
    await page.getByRole('link', { name: '一覧へ戻る' }).click()
    await page.getByLabel('検索', { exact: true }).waitFor()
    const item = page
      .getByRole('listitem')
      .filter({ has: page.locator('a[href="/incidents/i2"]'), hasText: '通知遅延' })
    check((await item.innerText()).includes('解決済み'), '一覧へ更新が反映されません')
    await page.reload({ waitUntil: 'networkidle' })
    const list = await item.innerText()
    check(list.includes('解決済み'), '一覧の再読み込みで更新が消えました')
    await page.goto(base + '/incidents/i2', { waitUntil: 'networkidle' })
    const reloaded = await body(page)
    const api = await http('/api/incidents?q=' + encodeURIComponent('通知'))
    check(
      reloaded.includes('解決済み') && JSON.parse(api.body)[0].resolved === true,
      '詳細の再読み込みまたはAPIに更新がありません',
    )
    return { linkTabs, buttonTabs, status: response.status(), detail, list, reloaded, api }
  })
  await test(6, 'ID別保存・別ID往復・再読み込み', async () => {
    const notes = [
      ['i2', '操作確認i2：通知の再送'],
      ['i3', '操作確認i3：検索の調査'],
    ]
    for (const [id, note] of notes) {
      await page.goto(base + '/incidents/' + id, { waitUntil: 'networkidle' })
      await page.getByLabel('作業メモ', { exact: true }).fill(note)
      await page.getByRole('link', { name: '一覧へ戻る' }).click()
      await page.getByLabel('検索', { exact: true }).waitFor()
    }
    const evidence = []
    for (const [id, expected] of notes) {
      await page
        .getByRole('listitem')
        .filter({ has: page.locator('a[href="/incidents/' + id + '"]') })
        .getByRole('link', { name: '詳細', exact: true })
        .click()
      await page.getByLabel('作業メモ', { exact: true }).waitFor()
      await page.reload({ waitUntil: 'networkidle' })
      const value = await page.getByLabel('作業メモ', { exact: true }).inputValue()
      check(value === expected, id + 'のメモが保持されません')
      evidence.push({ id, value })
      await page.getByRole('link', { name: '一覧へ戻る' }).click()
      await page.getByLabel('検索', { exact: true }).waitFor()
    }
    return {
      values: evidence,
      stored: await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))),
    }
  })
  await test(7, '監視の登録0→1→0→1→0・受信数・同一文書', async () => {
    await page.goto(base, { waitUntil: 'networkidle' })
    const marker = await page.evaluate(() => window.__operator.marker)
    const active = () => page.evaluate(() => window.__operator.active.length)
    const counts = [await active()]
    const texts = []
    for (const id of ['i1', 'i2']) {
      await page
        .getByRole('listitem')
        .filter({ has: page.locator('a[href="/incidents/' + id + '"]') })
        .getByRole('link', { name: '詳細', exact: true })
        .click()
      await page.getByLabel('作業メモ', { exact: true }).waitFor()
      counts.push(await active())
      const before = await body(page)
      const beforeCount = await page.getByLabel('受信数', { exact: true }).innerText()
      await page.evaluate(() => window.dispatchEvent(new Event('incident-ping')))
      await page.waitForTimeout(50)
      const after = await body(page)
      const afterCount = await page.getByLabel('受信数', { exact: true }).innerText()
      check(
        beforeCount.trim() === '0' && afterCount.trim() === '1',
        '1回の送信で受信数が0から1になりません',
      )
      texts.push({ id, beforeCount, afterCount, before, after })
      await page.getByRole('link', { name: '一覧へ戻る' }).click()
      await page.getByLabel('検索', { exact: true }).waitFor()
      counts.push(await active())
    }
    check(counts.join(',') === '0,1,0,1,0', '監視が蓄積しています: ' + counts)
    check(
      (await page.evaluate(() => window.__operator.marker)) === marker,
      '監視検査中に文書が再読み込みされました',
    )
    return { counts, texts, changes: await page.evaluate(() => window.__operator.changes) }
  })
  await test(8, '検索未応答中にTabとEnterで詳細へ遷移・応答後も詳細維持', async () => {
    const search = page.getByLabel('検索', { exact: true })
    const responses = []
    const listener = (r) => {
      if (new URL(r.url()).searchParams.get('q') === '決済')
        responses.push({ status: r.status(), at: Date.now() })
    }
    page.on('response', listener)
    const pending = page.waitForRequest((r) => new URL(r.url()).searchParams.get('q') === '決済')
    await search.focus()
    await page.keyboard.type('決済')
    await pending
    const started = Date.now()
    const pendingBefore = responses.length === 0
    const first = page.getByRole('link', { name: '詳細', exact: true }).first()
    const tabs = await tabTo(page, first)
    const marker = await page.evaluate(() => window.__operator.marker)
    await page.keyboard.press('Enter')
    await page.waitForURL('**/incidents/i1')
    await page.getByLabel('作業メモ', { exact: true }).waitFor()
    const pendingAfter = responses.length === 0
    const navigationAfterRequestMs = Date.now() - started
    await page.waitForTimeout(800)
    const text = await body(page)
    check(pendingBefore && pendingAfter, '未応答中の遷移を観測できません')
    check(
      responses.length === 1 && responses[0].status === 200,
      '実際の決済検索の200応答を観測できません',
    )
    check(
      new URL(page.url()).pathname === '/incidents/i1' &&
        (await page.getByLabel('作業メモ', { exact: true }).isVisible()) &&
        (await search.count()) === 0,
      '検索応答で詳細が書き換わりました',
    )
    check(
      (await page.evaluate(() => window.__operator.marker)) === marker,
      '未応答中のリンクで文書全体が再読み込みされました',
    )
    await page.screenshot({ path: out + '/pending-detail.png', fullPage: true })
    page.off('response', listener)
    return {
      tabs,
      pendingBefore,
      pendingAfter,
      navigationAfterRequestMs,
      responses,
      body: text,
      url: page.url(),
    }
  })
} finally {
  await writeFile(
    out + '/additional-result.json',
    JSON.stringify(
      {
        completedAt: new Date().toISOString(),
        base,
        passed: results.length === 8 && results.every((x) => x.passed) && errors.length === 0,
        results,
        errors,
      },
      null,
      2,
    ),
  )
  await browser.close()
}
process.exitCode =
  results.length === 8 && results.every((x) => x.passed) && errors.length === 0 ? 0 : 1
