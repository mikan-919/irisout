import assert from 'node:assert/strict'
import { describe, test } from 'bun:test'
import { createPlaygroundPageHandler } from './playground-ssr.mjs'

const origin = 'https://irisout.example'
const firstId = 'aaaaaaaaaaaaaaaaaaaaaa'
const secondId = 'bbbbbbbbbbbbbbbbbbbbbb'

describe('共有Playground SSR', () => {
  test('保存後の表示値を一つのrender入力からhead、本文、stateへ渡す', async () => {
    const records = new Map([
      [firstId, makeRecord(firstId, { title: 'A', source: 'export function A() {}' })],
    ])
    const inputs = []
    const handle = createPlaygroundPageHandler({
      store: { findById: (id) => records.get(id) ?? null },
      officialOrigin: origin,
      render(input) {
        inputs.push(input)
        const record = input.record
        return {
          html: `<main><h1>${escapeText(record.title)}</h1><p>未実行</p><pre>${escapeText(record.source)}</pre></main>`,
          state: { __irisout_state__: true, input, signals: {} },
        }
      },
    })

    const response = await handle(new Request(`${origin}/playground/${firstId}`))
    const html = await response.text()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow')
    assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self'/)
    assert.match(html, /<title>A<\/title>/)
    assert.match(html, /<h1>A<\/h1>/)
    assert.match(html, /未実行/)
    assert.match(html, /src="\/shared-playground\.js"/)
    assert.equal(inputs.length, 1)
    assert.deepEqual(inputs[0].record, {
      id: firstId,
      title: 'A',
      description: '説明',
      source: 'export function A() {}',
      compilerVersion: '0.2.2',
      createdAt: '2026-09-14T00:00:00.000Z',
    })
    assert.doesNotMatch(html, /delete_token|管理鍵|secret-token/)
  })

  test('危険な文字列をHTML文脈とstateへ安全に出す', async () => {
    const record = makeRecord(firstId, {
      title: '" onmouseover="alert(1) <title>',
      description: "' /><script>alert(1)</script>",
      source: '</script><img src=x onerror=alert(1)> & "',
    })
    const handle = createPlaygroundPageHandler({
      store: { findById: () => record },
      officialOrigin: origin,
      render({ record: value }) {
        return {
          html: `<main><h1>${escapeText(value.title)}</h1><p>${escapeText(value.description)}</p><pre>${escapeText(value.source)}</pre></main>`,
          state: { __irisout_state__: true, input: { record: value }, signals: {} },
        }
      },
    })

    const response = await handle(new Request(`${origin}/playground/${firstId}`))
    const html = await response.text()
    assert.equal(response.status, 200)
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
    assert.doesNotMatch(html, /onmouseover="alert\(1\)"/)
    assert.match(html, /\\u003C\/script\\u003E/)
    const stateText = html.match(
      /<script id="playground-state" type="application\/json">([\s\S]*?)<\/script>/,
    )?.[1]
    assert.ok(stateText)
    assert.equal(JSON.parse(stateText).input.record.source, record.source)
  })

  test('404、削除済み、形式不正では正常stateを返さない', async () => {
    const handle = createPlaygroundPageHandler({
      store: { findById: () => null },
      officialOrigin: origin,
      render() {
        throw new Error('should not render')
      },
    })
    for (const url of [
      `${origin}/playground/${firstId}`,
      `${origin}/playground/not-an-id`,
      `${origin}/playground/${firstId}%2Fdeleted`,
    ]) {
      const response = await handle(new Request(url))
      assert.equal(response.status, 404)
      assert.equal(await response.text(), 'not found')
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow')
    }
  })

  test('末尾slashを308へ正規化する', async () => {
    const handle = createPlaygroundPageHandler({
      store: { findById: () => null },
      officialOrigin: origin,
      render() {
        throw new Error('should not render')
      },
    })
    const response = await handle(new Request(`${origin}/playground/${firstId}/?x=1`))
    assert.equal(response.status, 308)
    assert.equal(response.headers.get('location'), `/playground/${firstId}?x=1`)
  })

  test('保存先障害は503とno-store、noindex、no-referrerを返す', async () => {
    const handle = createPlaygroundPageHandler({
      store: {
        findById() {
          throw new Error('sqlite stopped')
        },
      },
      officialOrigin: origin,
      render() {
        throw new Error('should not render')
      },
    })
    const response = await handle(new Request(`${origin}/playground/${firstId}`))
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow')
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  })

  test('A/B要求と失敗後の正常要求でstateを共有しない', async () => {
    const records = new Map([
      [firstId, makeRecord(firstId, { title: 'A' })],
      [secondId, makeRecord(secondId, { title: 'B' })],
    ])
    const handle = createPlaygroundPageHandler({
      store: { findById: (id) => records.get(id) ?? null },
      officialOrigin: origin,
      render({ record }) {
        return {
          html: `<main><h1>${escapeText(record.title)}</h1></main>`,
          state: { __irisout_state__: true, input: { record }, signals: {} },
        }
      },
    })
    const [a, b] = await Promise.all([
      handle(new Request(`${origin}/playground/${firstId}`)),
      handle(new Request(`${origin}/playground/${secondId}`)),
    ])
    const aHtml = await a.text()
    const bHtml = await b.text()
    assert.match(aHtml, />A<\/h1>/)
    assert.doesNotMatch(aHtml, />B<\/h1>/)
    assert.match(bHtml, />B<\/h1>/)
    assert.doesNotMatch(bHtml, />A<\/h1>/)
  })
})

function makeRecord(id, overrides = {}) {
  return {
    id,
    title: 'タイトル',
    description: '説明',
    source: 'export function App() {}',
    compilerVersion: '0.2.2',
    createdAt: '2026-09-14T00:00:00.000Z',
    ...overrides,
  }
}

function escapeText(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
