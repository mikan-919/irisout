// 文書SSGの入力検査と出力契約を、公開物をブラウザへ送らずに検証する。

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSite,
  DOCUMENT_SECTIONS,
  SiteBuildError,
  parseDocumentSource,
  validateDocumentRegistry,
} from './build-docs.mjs'

const metadata = `---
title: 試験文書
description: 入力検査の試験
slug: test-document
section: 導入
order: 1
---

# 試験文書

## 見出し

本文です。
`

void test('文書SSGが正本、一覧、検索索引を生成する', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'irisout-site-test-'))
  try {
    const result = buildSite({ outputDir })
    assert.equal(result.documents.length, 1)
    assert.equal(result.examples.length, 3)
    const detail = readFileSync(join(outputDir, 'getting-started/index.html'), 'utf8')
    const index = readFileSync(join(outputDir, 'index.html'), 'utf8')
    const searchIndex = readFileSync(join(outputDir, 'search-index.json'), 'utf8')
    const examples = readFileSync(join(outputDir, 'examples.json'), 'utf8')
    assert.match(detail, /npm公開版から始める/)
    assert.match(detail, /id="1-パッケージを導入する"/)
    assert.match(detail, /rel="canonical"/)
    assert.match(index, /Counter/)
    for (const section of DOCUMENT_SECTIONS) assert.match(index, new RegExp(section))
    assert.match(examples, /"id": "counter"/)
    assert.match(examples, /"sourceFile": "counter\.jsx"/)
    assert.match(examples, /signal\(0\)/)
    assert.match(searchIndex, /1\. パッケージを導入する/)
    assert.doesNotMatch(detail, /src="\/app\.js"/)
    assert.doesNotMatch(detail, /markdown/i)
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
})

void test('文書間リンクは全件の見出し収集後に検査する', () => {
  const sourceA = `---
title: 文書A
description: 文書間リンク元
slug: document-a
section: 導入
order: 1
---

# 文書A

[文書Bへ](document-b.md#target)
`
  const sourceB = `---
title: 文書B
description: 文書間リンク先
slug: document-b
section: API
order: 1
---

# 文書B

## Target

本文です。
`
  const documentA = parseDocumentSource(sourceA, '/tmp/site-docs/document-a.md', [], [], {
    render: false,
  })
  const documentB = parseDocumentSource(sourceB, '/tmp/site-docs/document-b.md', [], [], {
    render: false,
  })
  const rendered = parseDocumentSource(sourceA, '/tmp/site-docs/document-a.md', [
    documentA,
    documentB,
  ])
  assert.match(rendered.html, /href="\/docs\/document-b#target"/)
})

void test('絶対形式の文書・見出し・画像参照を実在検査する', () => {
  const sourceA = `---
title: 文書A
description: 絶対参照の検査元
slug: document-a
section: 導入
order: 1
---

# 文書A

[一覧](/docs)
[文書B](/docs/%64ocument-b#target)
![logo](/docs/assets/logo.webp)
`
  const sourceB = `---
title: 文書B
description: 絶対参照の検査先
slug: document-b
section: API
order: 1
---

# 文書B

## Target

本文です。
`
  const sourcePathA = '/tmp/site-docs/document-a.md'
  const documentA = parseDocumentSource(sourceA, sourcePathA, [], [], { render: false })
  const documentB = parseDocumentSource(sourceB, '/tmp/site-docs/document-b.md', [], [], {
    render: false,
  })
  const allDocuments = [documentA, documentB]
  const rendered = parseDocumentSource(sourceA, sourcePathA, allDocuments)

  assert.match(rendered.html, /href="\/docs"/)
  assert.match(rendered.html, /href="\/docs\/document-b#target"/)
  assert.match(rendered.html, /src="\/docs\/assets\/logo\.webp"/)

  const renderDocumentLink = (href) =>
    parseDocumentSource(
      sourceA.replace('[文書B](/docs/%64ocument-b#target)', `[文書B](${href})`),
      sourcePathA,
      allDocuments,
    )
  const renderImageLink = (href) =>
    parseDocumentSource(
      sourceA.replace('![logo](/docs/assets/logo.webp)', `![logo](${href})`),
      sourcePathA,
      allDocuments,
    )
  const assertBuildError = (run, message) =>
    assert.throws(run, (error) => error instanceof SiteBuildError && message.test(error.message))

  assertBuildError(() => renderDocumentLink('/docs/missing'), /文書参照が切れています/)
  assertBuildError(() => renderDocumentLink('/docs/document-b#missing'), /見出し参照が切れています/)
  assertBuildError(() => renderDocumentLink('/docs/../document-b'), /path traversal/)
  assertBuildError(() => renderDocumentLink('/docs/%2e%2e/document-b'), /path traversal/)
  assertBuildError(() => renderDocumentLink('/docs/%ZZ'), /不正なpercent encoding/)
  assertBuildError(() => renderDocumentLink('/docs/document-b#bad%'), /不正なpercent encoding/)
  assertBuildError(() => renderDocumentLink('../../document-b.md'), /path traversal/)
  assertBuildError(() => renderImageLink('/docs/assets/missing.webp'), /画像参照が切れています/)
  assertBuildError(() => renderImageLink('/docs/../assets/logo.webp'), /path traversal/)
  assertBuildError(() => renderImageLink('/docs/assets/%ZZ'), /不正なpercent encoding/)
  assertBuildError(
    () => renderImageLink('https://example.com/assets/%ZZ'),
    /不正なpercent encoding/,
  )
})

void test('8分類を許可し、未知の分類を拒否する', () => {
  assert.deepEqual(DOCUMENT_SECTIONS, [
    '導入',
    '状態と更新',
    'イベント',
    '条件分岐と一覧',
    '部品とファイル分割',
    'ライフサイクル',
    'API',
    '診断と対応範囲',
  ])
  assert.throws(
    () =>
      parseDocumentSource(
        metadata.replace('section: 導入', 'section: 未登録'),
        '/tmp/test-document.md',
      ),
    (error) => error instanceof SiteBuildError && /未知の文書分類/.test(error.message),
  )
  assert.throws(
    () =>
      validateDocumentRegistry([
        { slug: 'same', section: '導入', order: 1 },
        { slug: 'same', section: 'イベント', order: 1 },
      ]),
    (error) => error instanceof SiteBuildError && /slugが重複/.test(error.message),
  )
  assert.throws(
    () =>
      validateDocumentRegistry([
        { slug: 'first', section: '導入', order: 1 },
        { slug: 'second', section: '導入', order: 1 },
      ]),
    (error) => error instanceof SiteBuildError && /orderが重複/.test(error.message),
  )
})

void test('任意HTML、未知のコード言語、切れた見出し参照を拒否する', () => {
  assert.throws(
    () => parseDocumentSource(`${metadata}<aside>禁止</aside>\n`, '/tmp/test-document.md'),
    (error) => error instanceof SiteBuildError && /HTMLは許可されていません/.test(error.message),
  )
  assert.throws(
    () =>
      parseDocumentSource(
        `${metadata}\n\`\`\`rust\nfn main() {}\n\`\`\`\n`,
        '/tmp/test-document.md',
      ),
    (error) => error instanceof SiteBuildError && /未知のコード言語/.test(error.message),
  )
  assert.throws(
    () => parseDocumentSource(`${metadata}\n[壊れた参照](#missing)\n`, '/tmp/test-document.md', []),
    (error) => error instanceof SiteBuildError && /見出し参照が切れています/.test(error.message),
  )
  assert.throws(
    () =>
      parseDocumentSource(
        `${metadata}\n{{example:unknown}}\n`,
        '/tmp/test-document.md',
        [],
        [{ id: 'counter' }],
      ),
    (error) => error instanceof SiteBuildError && /登録されていない公式例/.test(error.message),
  )
})
