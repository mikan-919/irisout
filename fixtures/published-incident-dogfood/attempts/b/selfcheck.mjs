import { createRequire } from 'node:module'
const require = createRequire(new URL('../../../../packages/bench/package.json', import.meta.url))
const { chromium } = require('playwright')
const url =
  process.env.DOGFOOD_BASE_URL ?? 'http://127.0.0.1:' + (process.env.DOGFOOD_PORT ?? '4317')
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
  console.log('PASS ' + message)
}
const response = await fetch(url + '/')
const html = await response.text()
assert(
  response.status === 200 && ['決済API停止', '通知遅延', '検索障害'].every((t) => html.includes(t)),
  'SSR一覧が3件の件名を含む',
)
const detail = await fetch(url + '/incidents/i1')
assert(
  detail.status === 200 && (await detail.text()).includes('決済API停止'),
  'SSR詳細が件名を含む',
)
assert((await fetch(url + '/incidents/missing')).status === 404, '存在しない詳細は404')
assert(
  (await fetch(url + '/api/incidents?q=' + encodeURIComponent('失敗'))).status === 503,
  'API失敗は503',
)
for (const [q, delay] of [
  ['決済', 600],
  ['通知', 30],
]) {
  const start = performance.now()
  const result = await fetch(url + '/api/incidents?q=' + encodeURIComponent(q))
  const rows = await result.json()
  const elapsed = performance.now() - start
  assert(
    rows.length === 1 && elapsed >= delay - 5,
    'API遅延 ' + q + ': ' + elapsed.toFixed(0) + 'ms',
  )
}
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  headless: true,
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.addInitScript(() => {
  window.__documentMarker = Math.random()
  window.__pingListeners = new Set()
  const add = window.addEventListener.bind(window)
  const remove = window.removeEventListener.bind(window)
  window.addEventListener = (type, fn, options) => {
    if (type === 'incident-ping') window.__pingListeners.add(fn)
    add(type, fn, options)
  }
  window.removeEventListener = (type, fn, options) => {
    if (type === 'incident-ping') window.__pingListeners.delete(fn)
    remove(type, fn, options)
  }
})
try {
  await page.goto(url)
  await page.getByLabel('検索', { exact: true }).waitFor()
  const marker = await page.evaluate(() => window.__documentMarker)
  const input = page.getByLabel('検索', { exact: true })
  await input.fill('決済')
  await input.fill('通知')
  await page.waitForTimeout(800)
  assert(
    (await page.locator('li').count()) === 1 &&
      (await page.locator('li').textContent()).includes('通知遅延'),
    '600ms対30msの競合で通知だけ残る',
  )
  await input.fill('失敗')
  await page.getByRole('status').filter({ hasText: '検索失敗' }).waitFor()
  await input.fill('通知')
  await page.waitForTimeout(120)
  assert(
    (await page.getByRole('status').textContent()) === '' &&
      (await page.locator('li').count()) === 1,
    '503を表示し次の検索で回復',
  )
  await input.fill('')
  await page.waitForTimeout(100)
  await page
    .locator('li')
    .filter({ hasText: '決済API停止' })
    .getByRole('link', { name: '詳細', exact: true })
    .click()
  await page.getByRole('heading', { name: '決済API停止', exact: true }).waitFor()
  assert(
    (await page.evaluate(() =>
      window.__documentMarker === undefined ? false : window.__documentMarker,
    )) === marker,
    'ブラウザー遷移は文書再読み込みなし',
  )
  assert((await page.getByLabel('受信数').textContent()) === '0', '監視登録時の受信数0')
  assert((await page.evaluate(() => window.__pingListeners.size)) === 1, '詳細の監視登録は1')
  await page.evaluate(() => window.dispatchEvent(new Event('incident-ping')))
  assert((await page.getByLabel('受信数').textContent()) === '1', '監視イベント受信で表示更新')
  await page.getByLabel('作業メモ').fill('決済の作業メモ')
  await page.getByRole('button', { name: '解決する' }).click()
  await page.getByRole('status').filter({ hasText: '解決済み' }).waitFor()
  await page.getByRole('link', { name: '一覧へ戻る', exact: true }).click()
  await page.getByLabel('検索', { exact: true }).waitFor()
  assert(
    (await page.evaluate(() => window.__pingListeners.size)) === 0,
    '詳細から一覧への遷移で監視解除',
  )
  assert(
    (await page.locator('li').filter({ hasText: '決済API停止' }).textContent()).includes(
      '解決済み',
    ),
    '一覧が更新を反映',
  )
  await page.reload()
  assert(
    (await page.locator('li').filter({ hasText: '決済API停止' }).textContent()).includes(
      '解決済み',
    ),
    '再読み込みでも更新を反映',
  )
  await page
    .locator('li')
    .filter({ hasText: '通知遅延' })
    .getByRole('link', { name: '詳細', exact: true })
    .click()
  await page.getByRole('heading', { name: '通知遅延', exact: true }).waitFor()
  assert((await page.getByLabel('作業メモ').inputValue()) === '', 'i2のメモはi1と分離')
  await page.getByLabel('作業メモ').fill('通知の作業メモ')
  await page.getByRole('link', { name: '一覧へ戻る', exact: true }).click()
  await page.getByLabel('検索', { exact: true }).waitFor()
  await page
    .locator('li')
    .filter({ hasText: '決済API停止' })
    .getByRole('link', { name: '詳細', exact: true })
    .click()
  await page.getByRole('heading', { name: '決済API停止', exact: true }).waitFor()
  assert(
    (await page.getByLabel('作業メモ').inputValue()) === '決済の作業メモ',
    'i1のメモを遷移後に復元',
  )
  await page.reload()
  assert(
    (await page.getByLabel('作業メモ').inputValue()) === '決済の作業メモ',
    'メモを再読み込み後に復元',
  )
  for (let i = 0; i < 3; i++) {
    assert(
      (await page.evaluate(() => window.__pingListeners.size)) === 1,
      '反復詳細の監視登録1 回' + i,
    )
    await page.evaluate(() => window.dispatchEvent(new Event('incident-ping')))
    assert((await page.getByLabel('受信数').textContent()) === '1', '反復詳細のイベント1 回' + i)
    await page.getByRole('link', { name: '一覧へ戻る', exact: true }).click()
    await page.getByLabel('検索', { exact: true }).waitFor()
    assert(
      (await page.evaluate(() => window.__pingListeners.size)) === 0,
      '反復一覧の監視登録0 回' + i,
    )
    if (i < 2) {
      await page
        .locator('li')
        .filter({ hasText: '決済API停止' })
        .getByRole('link', { name: '詳細', exact: true })
        .click()
      await page.getByRole('heading', { name: '決済API停止', exact: true }).waitFor()
    }
  }
  await page.getByLabel('検索', { exact: true }).fill('決済')
  await page
    .locator('li')
    .filter({ hasText: '通知遅延' })
    .getByRole('link', { name: '詳細', exact: true })
    .click()
  await page.getByRole('heading', { name: '通知遅延', exact: true }).waitFor()
  await page.waitForTimeout(800)
  assert(
    (await page.getByRole('heading', { name: '通知遅延', exact: true }).count()) === 1 &&
      (await page.getByLabel('作業メモ').count()) === 1 &&
      (await page.locator('li').count()) === 0,
    '離れた一覧の応答が詳細を書き換えない',
  )
  assert(errors.length === 0, 'ブラウザー例外なし: ' + errors.join(','))
  console.log('ALL 8 REQUIREMENTS SELF-CHECKED')
} finally {
  await browser.close()
}
