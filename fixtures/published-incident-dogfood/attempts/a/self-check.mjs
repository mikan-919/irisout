import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../../../packages/bench/package.json', import.meta.url))
const { chromium } = require('playwright')

const base =
  process.env.DOGFOOD_BASE_URL ?? 'http://127.0.0.1:' + (process.env.DOGFOOD_PORT || 4317)
const passed = []
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  headless: true,
  args: ['--no-sandbox'],
})
try {
  const response = await fetch(base)
  const html = await response.text()
  for (const title of ['決済API停止', '通知遅延', '検索障害']) assert.ok(html.includes(title))
  assert.equal((await fetch(base + '/incidents/missing')).status, 404)
  assert.equal((await fetch(base + '/api/incidents?q=' + encodeURIComponent('失敗'))).status, 503)
  passed.push('HTTP: 要求単位の初期HTMLに3件、存在しない詳細404、検索失敗503')

  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.addInitScript(() => {
    const add = window.addEventListener.bind(window)
    const remove = window.removeEventListener.bind(window)
    const listeners = new Set()
    window.__pingListeners = listeners
    window.addEventListener = (type, listener, options) => {
      if (type === 'incident-ping') listeners.add(listener)
      return add(type, listener, options)
    }
    window.removeEventListener = (type, listener, options) => {
      if (type === 'incident-ping') listeners.delete(listener)
      return remove(type, listener, options)
    }
  })
  await page.goto(base)
  await page.getByRole('heading', { name: '決済API停止' }).waitFor()
  const search = page.getByRole('searchbox', { name: '検索' })
  await search.fill('決済')
  await page.waitForTimeout(60)
  await search.fill('通知')
  await page.waitForTimeout(850)
  assert.equal(await page.locator('li').count(), 1)
  assert.equal(await page.locator('li h2').innerText(), '通知遅延')
  passed.push('ブラウザー: 遅い決済→速い通知の競合後に通知だけ表示')
  await search.fill('失敗')
  await page.getByRole('status').filter({ hasText: '検索に失敗' }).waitFor()
  await search.fill('通知')
  await page.waitForTimeout(120)
  assert.equal(await page.getByRole('status').innerText(), '')
  passed.push('ブラウザー: 503を表示し次の検索で回復')

  await page.evaluate(() => {
    window.__sameDocument = 'alive'
  })
  await page.getByRole('link', { name: '詳細', exact: true }).click()
  await page.getByRole('heading', { name: '通知遅延' }).waitFor()
  assert.equal(await page.evaluate(() => window.__sameDocument), 'alive')
  await page.waitForFunction(() => window.__pingListeners.size === 1, { timeout: 5000 })
  assert.equal(await page.evaluate(() => window.__pingListeners.size), 1)
  await page.getByRole('textbox', { name: '作業メモ' }).fill('通知のメモ')
  await page.evaluate(() => window.dispatchEvent(new Event('incident-ping')))
  assert.equal(await page.locator('output').innerText(), '1')
  await page.getByRole('button', { name: '解決する' }).click()
  await page.getByText('解決済み', { exact: true }).waitFor()
  await page.getByRole('link', { name: '一覧へ戻る' }).click()
  await page.getByRole('heading', { name: '障害対応ボード' }).waitFor()
  assert.equal(await page.evaluate(() => window.__pingListeners.size), 0)
  assert.equal(
    await page.locator('li').filter({ hasText: '通知遅延' }).locator('p').innerText(),
    '解決済み',
  )
  passed.push('ブラウザー: 同一文書で詳細遷移し解決更新、一覧にも反映')

  await page
    .locator('li')
    .filter({ hasText: '決済API停止' })
    .getByRole('link', { name: '詳細' })
    .click()
  await page.getByRole('heading', { name: '決済API停止' }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '作業メモ' }).inputValue(), '')
  await page.getByRole('textbox', { name: '作業メモ' }).fill('決済のメモ')
  await page.getByRole('link', { name: '一覧へ戻る' }).click()
  await page.getByRole('heading', { name: '障害対応ボード' }).waitFor()
  await page
    .locator('li')
    .filter({ hasText: '通知遅延' })
    .getByRole('link', { name: '詳細' })
    .click()
  await page.getByRole('heading', { name: '通知遅延' }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '作業メモ' }).inputValue(), '通知のメモ')
  await page.waitForFunction(() => window.__pingListeners.size === 1, { timeout: 5000 })
  assert.equal(await page.evaluate(() => window.__pingListeners.size), 1)
  await page.evaluate(() => window.dispatchEvent(new Event('incident-ping')))
  assert.equal(await page.locator('output').innerText(), '1')
  await page.reload()
  await page.getByRole('heading', { name: '通知遅延' }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '作業メモ' }).inputValue(), '通知のメモ')
  await page.getByText('解決済み', { exact: true }).waitFor()
  passed.push('ブラウザー: ID別メモ、一覧と別詳細を経由し再読込しても保持、更新も保持')
  passed.push('ブラウザー: 監視数が詳細1→一覧0→詳細1、1イベントで受信数1')

  await page.getByRole('link', { name: '一覧へ戻る' }).click()
  await page.getByRole('heading', { name: '障害対応ボード' }).waitFor()
  await page.getByRole('searchbox', { name: '検索' }).fill('決済')
  await page
    .locator('li')
    .filter({ hasText: '通知遅延' })
    .getByRole('link', { name: '詳細' })
    .click()
  await page.getByRole('heading', { name: '通知遅延' }).waitFor()
  await page.waitForTimeout(850)
  assert.equal(await page.getByRole('heading', { name: '通知遅延' }).count(), 1)
  assert.equal(await page.locator('li').count(), 0)
  passed.push('ブラウザー: 検索中の詳細遷移後に古い一覧応答が詳細を変更しない')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed, browserErrors: errors }, null, 2))
} catch (error) {
  console.log(JSON.stringify({ passed, failure: String(error), stack: error.stack }, null, 2))
  process.exitCode = 1
} finally {
  await browser.close()
}
