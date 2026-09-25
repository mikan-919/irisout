// 公式Markdownと登録済みの公式例を、ブラウザ側の解析器なしで読める静的文書へ変換する。
// Markdown内の任意HTML、未知のコード言語、参照切れは公開物を書き出す前に拒否する。

import {
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  renameSync,
  statSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { compile, compileProject } from 'irisout'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const WEB_DIR = resolve(SCRIPT_DIR, '..')
const ROOT_DIR = resolve(WEB_DIR, '../..')
const DOC_MANIFEST_PATH = join(WEB_DIR, 'content/docs/manifest.json')
const EXAMPLE_MANIFEST_PATH = join(WEB_DIR, 'content/examples/manifest.json')
const DEFAULT_OUTPUT_DIR = join(WEB_DIR, 'public/docs')
const SITE_HEADER_CSS_PATH = join(WEB_DIR, 'src/site-header.css')
const DOCS_HEADER_ENTRY = join(WEB_DIR, `.docs-header-${process.pid}.jsx`)
const DOCS_HEADER_HTML = (() => {
  writeFileSync(
    DOCS_HEADER_ENTRY,
    `import { render } from 'irisout'\nimport { SiteHeader } from './src/SiteHeader.jsx'\nexport function DocsHeader() { render(<SiteHeader current="docs" search={false} onSearch={null} />) }\n`,
  )
  try {
    return compileProject(DOCS_HEADER_ENTRY).initialHtml
  } finally {
    rmSync(DOCS_HEADER_ENTRY, { force: true })
  }
})()
const SITE_ORIGIN = process.env.IRISOUT_SITE_ORIGIN ?? 'https://irisout.dev'
const SITE_VERSION = '0.3.0'

export const DOCUMENT_SECTIONS = Object.freeze([
  '導入',
  '状態と更新',
  'イベント',
  '条件分岐と一覧',
  '部品とファイル分割',
  'ライフサイクル',
  'API',
  '診断と対応範囲',
])

const ALLOWED_CODE_LANGUAGES = new Set([
  '',
  'bash',
  'css',
  'html',
  'javascript',
  'js',
  'json',
  'jsx',
  'sh',
  'text',
  'ts',
  'tsx',
  'typescript',
])

const FRONT_MATTER_KEYS = new Set(['title', 'description', 'slug', 'section', 'order'])
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export class SiteBuildError extends Error {
  constructor(message) {
    super(`site: ${message}`)
    this.name = 'SiteBuildError'
  }
}

function fail(message) {
  throw new SiteBuildError(message)
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error instanceof SiteBuildError) throw error
    fail(`${label}を読み込めません: ${error.message}`)
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttribute(value) {
  return escapeHtml(value)
}

function stripInlineMarkup(value) {
  return value
    .replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replaceAll(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replaceAll(/[`*_~]/g, '')
    .trim()
}

function parseScalar(value, key, filePath) {
  const trimmed = value.trim()
  if (trimmed === '') fail(`${filePath}: front matterの${key}が空です`)
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function parseFrontMatter(source, filePath = '<source>') {
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
    fail(`${filePath}: front matterが必要です`)
  }

  const lines = source.split(/\r?\n/)
  const end = lines.indexOf('---', 1)
  if (end < 0) fail(`${filePath}: front matterの終端がありません`)

  const values = {}
  for (const [index, line] of lines.slice(1, end).entries()) {
    if (line.trim() === '') continue
    const match = /^(title|description|slug|section|order):\s*(.*)$/.exec(line)
    if (!match) fail(`${filePath}:${index + 2}: 未知のfront matter項目です`)
    const [, key, value] = match
    if (Object.hasOwn(values, key)) fail(`${filePath}: front matterの${key}が重複しています`)
    values[key] = parseScalar(value, key, filePath)
  }

  for (const key of FRONT_MATTER_KEYS) {
    if (!Object.hasOwn(values, key)) fail(`${filePath}: front matterの${key}がありません`)
  }

  const order = Number(values.order)
  if (!Number.isInteger(order) || order < 1) {
    fail(`${filePath}: front matterのorderは1以上の整数で指定してください`)
  }
  values.order = order

  if (!SLUG_PATTERN.test(values.slug)) {
    fail(`${filePath}: slugは英小文字・数字・ハイフンの一階層で指定してください`)
  }
  if (!DOCUMENT_SECTIONS.includes(values.section)) {
    fail(`${filePath}: 未知の文書分類です: ${values.section}`)
  }

  const body = lines
    .slice(end + 1)
    .join('\n')
    .replace(/^\n+/, '')
  return { metadata: values, body }
}

function sourcePathFromManifest(manifestPath, source) {
  const path = resolve(dirname(manifestPath), source)
  if (!path.startsWith(`${ROOT_DIR}${sep}`) && path !== ROOT_DIR) {
    fail(`文書のsourceがリポジトリ外を指しています: ${source}`)
  }
  if (!existsSync(path)) fail(`文書のsourceが存在しません: ${source}`)
  return path
}

export function validateDocumentRegistry(documents) {
  const documentSlugs = new Set()
  const sectionOrders = new Map()
  for (const document of documents) {
    if (documentSlugs.has(document.slug)) fail(`文書slugが重複しています: ${document.slug}`)
    documentSlugs.add(document.slug)
    const orders = sectionOrders.get(document.section) ?? new Set()
    if (orders.has(document.order)) {
      fail(`文書分類内のorderが重複しています: ${document.section} ${document.order}`)
    }
    orders.add(document.order)
    sectionOrders.set(document.section, orders)
  }
}

function loadManifests() {
  const docManifest = readJson(DOC_MANIFEST_PATH, '文書一覧')
  const exampleManifest = readJson(EXAMPLE_MANIFEST_PATH, '公式例一覧')
  if (docManifest.version !== SITE_VERSION) {
    fail(`文書一覧の対象版が${SITE_VERSION}ではありません: ${docManifest.version}`)
  }
  if (JSON.stringify(docManifest.sections) !== JSON.stringify(DOCUMENT_SECTIONS)) {
    fail('文書一覧の分類が初回掲載範囲と一致しません')
  }
  if (exampleManifest.version !== SITE_VERSION) {
    fail(`公式例一覧の対象版が${SITE_VERSION}ではありません: ${exampleManifest.version}`)
  }
  if (!Array.isArray(docManifest.documents) || docManifest.documents.length === 0) {
    fail('文書一覧が空です')
  }
  if (!Array.isArray(exampleManifest.examples) || exampleManifest.examples.length === 0) {
    fail('公式例一覧が空です')
  }

  const documents = docManifest.documents.map((entry, index) => {
    if (!entry || typeof entry.source !== 'string') {
      fail(`文書一覧の${index + 1}件目にsourceがありません`)
    }
    const sourcePath = sourcePathFromManifest(DOC_MANIFEST_PATH, entry.source)
    const source = readFileSync(sourcePath, 'utf8')
    const parsed = parseFrontMatter(source, relative(ROOT_DIR, sourcePath))
    for (const key of ['section', 'order']) {
      if (Object.hasOwn(entry, key) && String(entry[key]) !== String(parsed.metadata[key])) {
        fail(`${relative(ROOT_DIR, sourcePath)}: manifestとfront matterの${key}が一致しません`)
      }
    }
    return {
      ...parsed.metadata,
      source,
      sourcePath,
      manifestSource: entry.source,
    }
  })

  const exampleIds = new Set()
  const examples = exampleManifest.examples.map((entry, index) => {
    if (!entry || typeof entry.id !== 'string' || typeof entry.source !== 'string') {
      fail(`公式例一覧の${index + 1}件目にidまたはsourceがありません`)
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) {
      fail(`公式例の識別子が不正です: ${entry.id}`)
    }
    if (exampleIds.has(entry.id)) fail(`公式例の識別子が重複しています: ${entry.id}`)
    exampleIds.add(entry.id)
    const sourcePath = resolve(dirname(EXAMPLE_MANIFEST_PATH), entry.source)
    if (!sourcePath.startsWith(`${resolve(WEB_DIR, 'content/examples')}${sep}`)) {
      fail(`公式例のsourceが登録済みディレクトリ外を指しています: ${entry.source}`)
    }
    if (!existsSync(sourcePath)) fail(`公式例のsourceが存在しません: ${entry.source}`)
    const source = readFileSync(sourcePath, 'utf8')
    validateOfficialExample(entry, source, sourcePath)
    return { ...entry, source, sourcePath, sourceFile: entry.source }
  })

  validateDocumentRegistry(documents)

  return { documents, examples }
}

function validateOfficialExample(entry, source, sourcePath) {
  if (!source.includes('render(')) fail(`公式例${entry.id}にrender()がありません`)
  if (!/export\s+function\s+[A-Za-z_$][\w$]*/.test(source)) {
    fail(`公式例${entry.id}にexportされたルート部品がありません`)
  }
  try {
    const result = compile(source)
    if (!result || typeof result.initialHtml !== 'string' || typeof result.code !== 'string') {
      fail(`公式例${entry.id}のコンパイル結果が不正です`)
    }
  } catch (error) {
    fail(`公式例${entry.id}をirisout@${SITE_VERSION}で検査できません: ${error.message}`)
  }
  if (!sourcePath.endsWith('.jsx')) fail(`公式例${entry.id}のsourceは.jsxで指定してください`)
}

function headingId(text, usedIds) {
  const clean = stripInlineMarkup(text).toLocaleLowerCase('ja-JP')
  let id = clean
    .replaceAll(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replaceAll(/[\s-]+/g, '-')
  if (id === '') id = 'section'
  const base = id
  let suffix = 2
  while (usedIds.has(id)) id = `${base}-${suffix++}`
  usedIds.add(id)
  return id
}

function detectRawHtml(lines, filePath) {
  let inFence = false
  for (const [index, line] of lines.entries()) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const withoutCode = line.replaceAll(/`[^`]*`/g, '')
    if (/<\/?[A-Za-z][^>]*>|<!--|<!DOCTYPE/i.test(withoutCode)) {
      fail(`${filePath}:${index + 1}: Markdown内のHTMLは許可されていません`)
    }
  }
}

function parseBlocks(body, filePath) {
  const lines = body.split(/\r?\n/)
  detectRawHtml(lines, filePath)
  const blocks = []
  let index = 0
  let inFirstHeading = true
  const usedHeadingIds = new Set()
  const headings = []

  while (index < lines.length) {
    const line = lines[index]
    if (line.trim() === '') {
      index += 1
      continue
    }

    const fence = /^\s*```([A-Za-z0-9_-]*)\s*$/.exec(line)
    if (fence) {
      const language = fence[1].toLowerCase()
      if (!ALLOWED_CODE_LANGUAGES.has(language)) {
        fail(`${filePath}:${index + 1}: 未知のコード言語です: ${language}`)
      }
      const start = index
      index += 1
      const codeLines = []
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index >= lines.length) fail(`${filePath}:${start + 1}: コードブロックが閉じていません`)
      index += 1
      blocks.push({ type: 'code', language, code: codeLines.join('\n') })
      continue
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const text = heading[2]
      if (level === 1 && !inFirstHeading) fail(`${filePath}: h1は文書名だけにしてください`)
      if (level === 1) inFirstHeading = false
      const id = headingId(text, usedHeadingIds)
      headings.push({ level, text, id })
      blocks.push({ type: 'heading', level, text, id })
      index += 1
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = []
      while (index < lines.length) {
        const item = /^\s*[-*+]\s+(.+)$/.exec(lines[index])
        if (!item) break
        items.push(item[1])
        index += 1
      }
      blocks.push({ type: 'list', ordered: false, items })
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = []
      while (index < lines.length) {
        const item = /^\s*\d+\.\s+(.+)$/.exec(lines[index])
        if (!item) break
        items.push(item[1])
        index += 1
      }
      blocks.push({ type: 'list', ordered: true, items })
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = []
      while (index < lines.length) {
        const item = /^\s*>\s?(.*)$/.exec(lines[index])
        if (!item) break
        quote.push(item[1])
        index += 1
      }
      blocks.push({ type: 'quote', text: quote.join('\n') })
      continue
    }

    const paragraph = [line]
    index += 1
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !/^\s*```/.test(lines[index]) &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^\s*[-*+]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index]) &&
      !/^\s*>\s?/.test(lines[index])
    ) {
      paragraph.push(lines[index])
      index += 1
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') })
  }

  if (headings.length === 0 || headings[0].level !== 1) {
    fail(`${filePath}: 文書名のh1がありません`)
  }
  return { blocks, headings }
}

function normalizeNewlines(value) {
  return value.replaceAll(/\r?\n/g, '\n')
}

function splitHref(rawHref) {
  const hashIndex = rawHref.indexOf('#')
  if (hashIndex < 0) return { path: rawHref, hash: '' }
  return { path: rawHref.slice(0, hashIndex), hash: rawHref.slice(hashIndex + 1) }
}

function decodeReferencePart(value, document, kind) {
  if (/%(?![0-9a-f]{2})/i.test(value)) {
    fail(`${document.sourcePath}: ${kind}に不正なpercent encodingがあります: ${value}`)
  }
  try {
    return decodeURIComponent(value)
  } catch {
    fail(`${document.sourcePath}: ${kind}をdecodeできません: ${value}`)
  }
}

function rejectTraversal(pathValue, document, kind) {
  if (pathValue.includes('\\')) {
    fail(`${document.sourcePath}: ${kind}に不正な区切り文字があります: ${pathValue}`)
  }
  if (pathValue.split('/').some((segment) => segment === '..')) {
    fail(`${document.sourcePath}: ${kind}にpath traversalがあります: ${pathValue}`)
  }
}

function isFileInside(rootPath, filePath) {
  return (
    filePath.startsWith(`${rootPath}${sep}`) && existsSync(filePath) && statSync(filePath).isFile()
  )
}

function resolveDocumentHref(rawHref, document, allDocuments) {
  const href = rawHref.trim()
  if (href === '') fail(`${document.sourcePath}: 空のリンク先です`)
  if (/%(?![0-9a-f]{2})/i.test(href)) {
    fail(`${document.sourcePath}: リンク先に不正なpercent encodingがあります: ${href}`)
  }
  if (/^(https?):\/\//i.test(href)) return href
  if (/^(javascript|data|vbscript):/i.test(href))
    fail(`${document.sourcePath}: 許可されないリンク先です: ${href}`)
  if (href.startsWith('#')) {
    const target = decodeReferencePart(href.slice(1), document, '見出し参照')
    if (!document.headings.some((heading) => heading.id === target)) {
      fail(`${document.sourcePath}: 見出し参照が切れています: ${href}`)
    }
    return `#${encodeURIComponent(target)}`
  }

  const { path: relativePath, hash } = splitHref(href)
  const decodedPath = decodeReferencePart(relativePath, document, '文書参照')
  const decodedHash = decodeReferencePart(hash, document, '見出し参照')
  rejectTraversal(decodedPath, document, '文書参照')
  if (relativePath.startsWith('/')) {
    if (decodedPath === '/docs') {
      if (decodedHash !== '')
        fail(`${document.sourcePath}: 文書一覧に見出し参照は指定できません: ${href}`)
      return '/docs'
    }
    if (!decodedPath.startsWith('/docs/'))
      fail(`${document.sourcePath}: サイト外の絶対リンクです: ${href}`)
    const slug = decodedPath.slice('/docs/'.length)
    if (!SLUG_PATTERN.test(slug)) {
      fail(`${document.sourcePath}: 絶対文書参照のslugが不正です: ${href}`)
    }
    const targetDocument = allDocuments.find((candidate) => candidate.slug === slug)
    if (!targetDocument) fail(`${document.sourcePath}: 文書参照が切れています: ${href}`)
    if (
      decodedHash !== '' &&
      !targetDocument.headings.some((heading) => heading.id === decodedHash)
    ) {
      fail(`${document.sourcePath}: 文書見出し参照が切れています: ${href}`)
    }
    return `/docs/${targetDocument.slug}${decodedHash ? `#${encodeURIComponent(decodedHash)}` : ''}`
  }

  const resolved = normalize(resolve(dirname(document.sourcePath), decodedPath))
  const targetDocument = allDocuments.find((candidate) => candidate.sourcePath === resolved)
  if (targetDocument) {
    if (decodedHash && !targetDocument.headings.some((heading) => heading.id === decodedHash)) {
      fail(`${document.sourcePath}: 文書見出し参照が切れています: ${href}`)
    }
    return `/docs/${targetDocument.slug}${decodedHash ? `#${encodeURIComponent(decodedHash)}` : ''}`
  }

  fail(`${document.sourcePath}: 文書参照が切れています: ${href}`)
}

function validateExampleReferences(source, sourcePath, examples = []) {
  const knownIds = new Set(examples.map((example) => example.id))
  const references = source.matchAll(/\{\{example:([a-z0-9-]+)\}\}/g)
  for (const reference of references) {
    if (!knownIds.has(reference[1])) {
      fail(`${sourcePath}: 登録されていない公式例を参照しています: ${reference[1]}`)
    }
  }
}

function resolveImageHref(rawHref, document) {
  const href = rawHref.trim()
  if (/%(?![0-9a-f]{2})/i.test(href)) {
    fail(`${document.sourcePath}: 画像参照に不正なpercent encodingがあります: ${href}`)
  }
  if (/^(https?):\/\//i.test(href)) return href
  if (href.startsWith('/')) {
    const decodedPath = decodeReferencePart(href, document, '画像参照')
    rejectTraversal(decodedPath, document, '画像参照')
    const assetPrefix = '/docs/assets/'
    if (!decodedPath.startsWith(assetPrefix))
      fail(`${document.sourcePath}: 画像の絶対リンクが不正です: ${href}`)
    const assetPath = resolve(join(ROOT_DIR, 'docs/assets'), decodedPath.slice(assetPrefix.length))
    if (!isFileInside(join(ROOT_DIR, 'docs/assets'), assetPath)) {
      fail(`${document.sourcePath}: 画像参照が切れています: ${href}`)
    }
    return `/docs/assets/${relative(join(ROOT_DIR, 'docs/assets'), assetPath).split(sep).join('/')}`
  }
  const decodedPath = decodeReferencePart(href, document, '画像参照')
  rejectTraversal(decodedPath, document, '画像参照')
  const imagePath = resolve(dirname(document.sourcePath), decodedPath)
  const assetRoot = join(ROOT_DIR, 'docs/assets')
  if (!isFileInside(assetRoot, imagePath)) {
    fail(`${document.sourcePath}: 画像参照が切れています: ${href}`)
  }
  const relativeImage = relative(assetRoot, imagePath).split(sep).join('/')
  return `/docs/assets/${relativeImage}`
}

function renderInline(value, document, allDocuments) {
  const input = normalizeNewlines(value)
  let output = ''
  let index = 0
  while (index < input.length) {
    if (input[index] === '`') {
      const end = input.indexOf('`', index + 1)
      if (end >= 0) {
        output += `<code>${escapeHtml(input.slice(index + 1, end))}</code>`
        index = end + 1
        continue
      }
    }
    if (input.startsWith('![', index)) {
      const labelEnd = input.indexOf('](', index + 2)
      const hrefEnd = labelEnd >= 0 ? input.indexOf(')', labelEnd + 2) : -1
      if (labelEnd >= 0 && hrefEnd >= 0) {
        const alt = input.slice(index + 2, labelEnd)
        const href = input.slice(labelEnd + 2, hrefEnd)
        output += `<img src="${escapeAttribute(resolveImageHref(href, document))}" alt="${escapeAttribute(alt)}" loading="lazy" />`
        index = hrefEnd + 1
        continue
      }
    }
    if (input[index] === '[') {
      const labelEnd = input.indexOf('](', index + 1)
      const hrefEnd = labelEnd >= 0 ? input.indexOf(')', labelEnd + 2) : -1
      if (labelEnd >= 0 && hrefEnd >= 0) {
        const label = input.slice(index + 1, labelEnd)
        const href = input.slice(labelEnd + 2, hrefEnd)
        output += `<a href="${escapeAttribute(resolveDocumentHref(href, document, allDocuments))}">${renderInline(label, document, allDocuments)}</a>`
        index = hrefEnd + 1
        continue
      }
    }
    if (input.startsWith('**', index)) {
      const end = input.indexOf('**', index + 2)
      if (end >= 0) {
        output += `<strong>${renderInline(input.slice(index + 2, end), document, allDocuments)}</strong>`
        index = end + 2
        continue
      }
    }
    if (input[index] === '*') {
      const end = input.indexOf('*', index + 1)
      if (end >= 0) {
        output += `<em>${renderInline(input.slice(index + 1, end), document, allDocuments)}</em>`
        index = end + 1
        continue
      }
    }
    if (input[index] === '\n') {
      output += '<br />'
      index += 1
      continue
    }
    output += escapeHtml(input[index])
    index += 1
  }
  return output
}

function highlightCode(code, language) {
  const escaped = escapeHtml(code)
  // 強調表示はビルド時に完了させ、ブラウザへMarkdown解析器や強調表示器を送らない。
  if (!language) return escaped
  return escaped.replace(
    /\b(const|let|function|return|export|import|from|if|else|new|true|false)\b/g,
    '<span class="tok-keyword">$1</span>',
  )
}

export function parseDocumentSource(
  source,
  sourcePath,
  allDocuments = [],
  examples = [],
  { render = true } = {},
) {
  const { metadata, body } = parseFrontMatter(source, sourcePath)
  validateExampleReferences(source, sourcePath, examples)
  const parsed = parseBlocks(body, sourcePath)
  const firstHeading = parsed.headings[0]
  if (stripInlineMarkup(firstHeading.text) !== metadata.title) {
    fail(`${sourcePath}: h1とfront matterのtitleが一致しません`)
  }
  const document = {
    ...metadata,
    source,
    sourcePath,
    blocks: parsed.blocks,
    headings: parsed.headings,
  }
  const htmlBlocks = render
    ? parsed.blocks
        .filter((block, index) => !(index === 0 && block.type === 'heading' && block.level === 1))
        .map((block) => {
          if (block.type === 'heading') {
            if (block.level === 1) fail(`${sourcePath}: 本文のh1は文書名だけにしてください`)
            return `<h${block.level} id="${escapeAttribute(block.id)}">${renderInline(block.text, document, allDocuments)}</h${block.level}>`
          }
          if (block.type === 'paragraph')
            return `<p>${renderInline(block.text, document, allDocuments)}</p>`
          if (block.type === 'quote')
            return `<blockquote>${renderInline(block.text, document, allDocuments)}</blockquote>`
          if (block.type === 'list') {
            const tag = block.ordered ? 'ol' : 'ul'
            return `<${tag}>${block.items.map((item) => `<li>${renderInline(item, document, allDocuments)}</li>`).join('')}</${tag}>`
          }
          if (block.type === 'code') {
            const className = block.language
              ? ` class="language-${escapeAttribute(block.language)}"`
              : ''
            return `<pre><code${className}>${highlightCode(block.code, block.language)}</code></pre>`
          }
          fail(`${sourcePath}: 未知のMarkdownブロックです`)
        })
    : []
  document.html = htmlBlocks.join('\n')
  document.toc = parsed.headings.filter((heading) => heading.level === 2 || heading.level === 3)
  return document
}

function documentSort(a, b) {
  return (
    DOCUMENT_SECTIONS.indexOf(a.section) - DOCUMENT_SECTIONS.indexOf(b.section) ||
    a.order - b.order ||
    a.slug.localeCompare(b.slug)
  )
}

function renderToc(document) {
  if (document.toc.length === 0) return ''
  return `<nav class="doc-toc" aria-label="目次"><strong>目次</strong><ol>${document.toc
    .map(
      (heading) =>
        `<li class="toc-level-${heading.level}"><a href="#${encodeURIComponent(heading.id)}">${escapeHtml(heading.text)}</a></li>`,
    )
    .join('')}</ol></nav>`
}

function renderDocumentNav(document, documents) {
  const sorted = [...documents].sort(documentSort)
  const index = sorted.findIndex((candidate) => candidate.slug === document.slug)
  const previous = index > 0 ? sorted[index - 1] : null
  const next = index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : null
  return `<nav class="doc-pager" aria-label="文書間の移動">${
    previous
      ? `<a class="doc-pager-prev" href="/docs/${previous.slug}"><span>前の文書</span>${escapeHtml(previous.title)}</a>`
      : '<span></span>'
  }${next ? `<a class="doc-pager-next" href="/docs/${next.slug}"><span>次の文書</span>${escapeHtml(next.title)}</a>` : '<span></span>'}</nav>`
}

function renderDocumentList(documents) {
  const groups = DOCUMENT_SECTIONS.map((section) => {
    const entries = documents.filter((document) => document.section === section).sort(documentSort)
    const links = entries
      .map(
        (document) =>
          `<li><a href="/docs/${document.slug}">${escapeHtml(document.title)}</a><p>${escapeHtml(document.description)}</p></li>`,
      )
      .join('')
    return `<section class="doc-group"><h2>${escapeHtml(section)}</h2>${links ? `<ul>${links}</ul>` : ''}</section>`
  }).join('')
  return groups
}

function renderSearchForm() {
  return `<form class="doc-search" data-doc-search-form="true" role="search"><label for="doc-search">ドキュメントを検索</label><div><input id="doc-search" name="q" type="search" placeholder="タイトルや見出し" autocomplete="off" /><button type="submit">検索</button></div><output data-doc-search-results="true" aria-live="polite"></output></form>`
}

function pageShell({ title, description, path, body, scripts = true }) {
  const canonical = `${SITE_ORIGIN}${path}`
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeAttribute(description)}" />
    <link rel="canonical" href="${escapeAttribute(canonical)}" />
    <meta property="og:title" content="${escapeAttribute(title)}" />
    <meta property="og:description" content="${escapeAttribute(description)}" />
    <meta property="og:url" content="${escapeAttribute(canonical)}" />
    <meta property="og:type" content="article" />
    <meta property="og:image" content="${escapeAttribute(`${SITE_ORIGIN}/og-image.webp`)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:type" content="image/webp" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${escapeAttribute(`${SITE_ORIGIN}/og-image.webp`)}" />
    <link rel="stylesheet" href="/docs/site.css" />
    <title>${escapeHtml(title)} — irisout</title>
  </head>
  <body>
    ${DOCS_HEADER_HTML}
    ${body}
    <footer class="site-footer"><a href="/">irisout</a><span>対象版 irisout@${SITE_VERSION}</span></footer>
    ${scripts ? '<script type="module" src="/docs/search.js"></script>' : ''}
  </body>
</html>
`
}

function renderIndexPage(documents, examples) {
  const exampleList = examples
    .map(
      (example) =>
        `<li><a href="/playground?example=${encodeURIComponent(example.id)}"><strong>${escapeHtml(example.title)}</strong><span>${escapeHtml(example.description)}</span></a><pre><code class="language-jsx">${highlightCode(example.source, 'jsx')}</code></pre></li>`,
    )
    .join('')
  const body = `<main class="docs-page docs-index"><div class="docs-heading"><p class="eyebrow">Documentation</p><h1>ドキュメント</h1><p>irisoutの導入、状態更新、部品、ライフサイクル、対応範囲を説明します。</p></div>${renderSearchForm()}<div class="docs-index-grid"><div>${renderDocumentList(documents)}</div><aside class="docs-examples"><h2>公式例</h2><p>表示用コードと、後続のPlaygroundが接続するexamples.jsonは同じJSXから生成しています。</p><ul>${exampleList}</ul></aside></div></main>`
  return pageShell({
    title: 'ドキュメント',
    description: 'irisoutの公式ドキュメントと公式例',
    path: '/docs',
    body,
  })
}

function renderDetailPage(document, documents) {
  const body = `<main class="docs-page docs-detail"><div class="docs-detail-grid"><aside>${renderToc(document)}</aside><article><p class="eyebrow">${escapeHtml(document.section)} · irisout@${SITE_VERSION}</p><h1>${escapeHtml(document.title)}</h1><p class="doc-description">${escapeHtml(document.description)}</p><div class="doc-body">${document.html}</div>${renderDocumentNav(document, documents)}</article></div></main>`
  return pageShell({
    title: document.title,
    description: document.description,
    path: `/docs/${document.slug}`,
    body,
  })
}

function renderSearchScript() {
  return `const form = document.querySelector('[data-doc-search-form]')
const output = document.querySelector('[data-doc-search-results]')
if (form && output) {
  let indexPromise
  const loadIndex = () => (indexPromise ??= fetch('/docs/search-index.json').then((response) => response.json()))
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const query = new FormData(form).get('q')?.toString().trim().toLocaleLowerCase('ja-JP') ?? ''
    if (!query) {
      output.replaceChildren()
      return
    }
    const entries = await loadIndex()
    const matches = entries.filter((entry) => entry.text.toLocaleLowerCase('ja-JP').includes(query)).slice(0, 20)
    output.replaceChildren()
    if (matches.length === 0) {
      const empty = document.createElement('span')
      empty.textContent = '見つかりません'
      output.append(empty)
      return
    }
    for (const entry of matches) {
      const link = document.createElement('a')
      link.href = entry.url
      link.textContent = entry.title
      output.append(link)
    }
  })
}
`
}

function renderCss() {
  return `:root { --color-accent: #075fcf; color-scheme: dark; font-family: system-ui, sans-serif; color: #f4f3f8; background: #0d0d12; }
* { box-sizing: border-box; }
body { margin: 0; min-width: 20rem; background: #0d0d12; color: #f4f3f8; line-height: 1.7; }
a { color: #b98aff; }
body .site-header { --h-accent: #b98aff; --h-ink: #f4f3f8; --h-muted: #b9b4c9; --h-paper: #0d0d12; --h-rule: #2b2937; width: 100%; padding-inline: max(1rem, calc((100% - 72rem) / 2)); }
body .site-header .site-cta { color: #19131f; }
.site-footer, .docs-page { width: min(72rem, calc(100% - 2rem)); margin: 0 auto; }
.site-footer { display: flex; justify-content: space-between; margin-top: 4rem; padding: 1.5rem 0 3rem; border-top: 1px solid #2b2937; color: #9b99ad; font-size: .85rem; }
.docs-page { padding: 4rem 0; }
.docs-shell { display: grid; grid-template-columns: 13rem minmax(0, 1fr); gap: 3rem; align-items: start; }
.docs-shell > * { min-width: 0; }
.docs-sidebar { position: sticky; top: 6rem; padding-right: 1rem; border-right: 1px solid #2b2937; }
.docs-sidebar-title { display: block; margin-bottom: .75rem; color: #f4f3f8; font-weight: 700; text-decoration: none; }
.docs-sidebar nav { display: grid; gap: .2rem; }
.docs-sidebar nav a { border-radius: .35rem; padding: .35rem .5rem; color: #9b99ad; font-size: .85rem; line-height: 1.4; text-decoration: none; }
.docs-sidebar nav a:hover { background: #15151d; color: #f4f3f8; }
.eyebrow { color: #b98aff; font-size: .75rem; letter-spacing: .12em; text-transform: uppercase; }
h1, h2, h3 { line-height: 1.2; }
h1 { font-size: clamp(2rem, 5vw, 3.5rem); }
.docs-heading { max-width: 44rem; }
.docs-heading p:not(.eyebrow), .doc-description { color: #b9b4c9; }
.doc-search { margin: 2rem 0 3rem; padding: 1rem; border: 1px solid #2b2937; border-radius: .75rem; }
.doc-search label { display: block; margin-bottom: .5rem; font-weight: 600; }
.doc-search div { display: flex; gap: .5rem; }
.doc-search input { width: 100%; border: 1px solid #4a465a; border-radius: .4rem; padding: .65rem .75rem; background: #15151d; color: inherit; }
.doc-search button { border: 0; border-radius: .4rem; padding: .65rem 1rem; background: #b98aff; color: #19131f; cursor: pointer; }
.doc-search output { display: flex; flex-wrap: wrap; gap: .6rem 1rem; margin-top: .75rem; }
.docs-index-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(18rem, .7fr); gap: 3rem; }
.docs-index-grid > * { min-width: 0; }
.doc-group { margin-bottom: 2.5rem; }
.doc-group h2, .docs-examples h2 { font-size: 1.2rem; }
.doc-group ul, .docs-examples ul { padding: 0; list-style: none; }
.doc-group li { margin: .8rem 0; }
.doc-group li a { font-weight: 600; }
.doc-group li p { margin: .15rem 0 0; color: #9b99ad; font-size: .9rem; }
.docs-examples { align-self: start; height: fit-content; padding: 1.25rem; border: 1px solid #2b2937; border-radius: .75rem; background: #15151d; }
.docs-examples p { color: #9b99ad; font-size: .9rem; }
.docs-examples li + li { margin-top: 1.5rem; }
.docs-examples a { display: flex; justify-content: space-between; gap: .5rem; text-decoration: none; }
.docs-examples a span { color: #9b99ad; font-size: .8rem; }
.docs-examples pre { max-height: 14rem; overflow: auto; }
.docs-detail-grid { display: grid; grid-template-columns: 14rem minmax(0, 1fr); gap: 3rem; }
.docs-detail-grid > * { min-width: 0; }
.doc-toc { position: sticky; top: 1rem; font-size: .85rem; }
.doc-toc strong { display: block; margin-bottom: .5rem; }
.doc-toc ol { margin: 0; padding-left: 1.25rem; }
.doc-toc li { margin: .35rem 0; }
.doc-toc .toc-level-3 { padding-left: .8rem; }
.doc-body { max-width: 50rem; }
.doc-body h2 { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #2b2937; }
.doc-body h3 { margin-top: 2rem; }
.doc-body p, .doc-body li { color: #d6d2df; }
.doc-body code { padding: .12rem .3rem; border-radius: .25rem; background: #211e2c; color: #e3ccff; }
.doc-body pre, .docs-examples pre { overflow-x: auto; padding: 1rem; border: 1px solid #2b2937; border-radius: .5rem; background: #111117; }
.doc-body pre code, .docs-examples pre code { padding: 0; background: transparent; color: #ded9ea; }
.tok-keyword { color: #e39cff; }
.doc-body blockquote { margin: 1.5rem 0; padding: .25rem 1rem; border-left: 3px solid #b98aff; color: #b9b4c9; }
.doc-pager { display: flex; justify-content: space-between; gap: 1rem; margin-top: 4rem; padding-top: 1rem; border-top: 1px solid #2b2937; }
.doc-pager a { display: grid; text-decoration: none; }
.doc-pager span { color: #9b99ad; font-size: .75rem; }
.doc-pager-next { text-align: right; }
@media (max-width: 56rem) { .docs-shell { grid-template-columns: 1fr; gap: 2rem; } .docs-sidebar { position: static; padding: 0 0 1rem; border-right: 0; border-bottom: 1px solid #2b2937; } .docs-sidebar nav { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 44rem) { .docs-index-grid, .docs-detail-grid { grid-template-columns: 1fr; } .docs-sidebar nav { grid-template-columns: 1fr; } .doc-toc { position: static; } .site-footer { display: block; } .site-footer span { display: block; margin-top: .5rem; } }
:root { --docs-paper: #f4f4f2; --docs-ink: #141414; --docs-muted: #6b6b65; --docs-rule: #d8d8d3; --docs-panel: #161714; --docs-header-bg: rgb(247 247 245 / 78%); color-scheme: light; color: var(--docs-ink); background: var(--docs-paper); }
body { background: var(--docs-paper); color: var(--docs-ink); font-family: Arial, "Helvetica Neue", sans-serif; }
a, .eyebrow, .doc-group li a { color: var(--docs-ink); }
body .site-header { --h-accent: var(--docs-ink); --h-ink: var(--docs-ink); --h-muted: var(--docs-muted); --h-paper: var(--docs-paper); --h-rule: transparent; width: 100%; padding-inline: max(18px, calc((100% - 73.75rem) / 2)); background: var(--docs-header-bg); backdrop-filter: blur(14px) saturate(120%); }
body .site-header .site-cta { background: transparent; color: var(--docs-muted); }
.docs-page { width: min(calc(100% - 3rem), 73.75rem); padding-top: 5rem; }
.docs-sidebar { border-color: var(--docs-rule); }
.docs-sidebar-title { color: var(--docs-ink); }
.docs-sidebar nav a, .docs-heading p:not(.eyebrow), .doc-description, .doc-group li p, .docs-examples p, .docs-examples a span, .doc-body p, .doc-body li, .doc-pager span { color: var(--docs-muted); }
.docs-sidebar nav a:hover { background: transparent; color: var(--docs-ink); }
.docs-heading h1, .docs-detail h1 { letter-spacing: -.055em; }
.doc-search, .doc-search input, .docs-examples, .doc-body code, .doc-body pre, .docs-examples pre { border-radius: 0; }
.doc-search, .docs-examples { border-color: var(--docs-rule); background: transparent; }
.doc-search input { border-color: var(--docs-rule); background: transparent; color: var(--docs-ink); }
.doc-search button { border-radius: 0; background: var(--docs-ink); color: var(--docs-paper); }
.doc-body h2, .doc-pager, .site-footer { border-color: var(--docs-rule); }
.doc-body code { background: #e7e7e3; color: var(--docs-ink); }
.doc-body pre, .docs-examples pre { border-color: var(--docs-panel); background: var(--docs-panel); }
.doc-body pre code, .docs-examples pre code { color: var(--docs-paper); }
.tok-keyword { color: #bcbcb4; }
.doc-body blockquote { border-color: var(--docs-ink); color: var(--docs-muted); }
.site-footer { color: var(--docs-muted); }
@media (max-width: 48rem) { body .site-header { padding-inline: 16px; } .docs-page { width: calc(100% - 2rem); } }
`
}

function renderSearchIndex(documents) {
  return documents
    .flatMap((document) => [
      {
        title: document.title,
        text: `${document.title} ${document.description}`,
        url: `/docs/${document.slug}`,
      },
      ...document.headings
        .filter((heading) => heading.level === 2 || heading.level === 3)
        .map((heading) => ({
          title: heading.text,
          text: `${heading.text} ${document.title}`,
          url: `/docs/${document.slug}#${encodeURIComponent(heading.id)}`,
        })),
    ])
    .map((entry) => ({ ...entry, title: entry.title, text: entry.text }))
}

function copyDocumentAssets(outputDir) {
  const sourceAssets = join(ROOT_DIR, 'docs/assets')
  if (!existsSync(sourceAssets)) return
  const targetAssets = join(outputDir, 'assets')
  const copy = (sourceDirectory, targetDirectory) => {
    mkdirSync(targetDirectory, { recursive: true })
    for (const name of readdirSync(sourceDirectory, { withFileTypes: true })) {
      const source = join(sourceDirectory, name.name)
      const target = join(targetDirectory, name.name)
      if (name.isDirectory()) copy(source, target)
      else writeFileSync(target, readFileSync(source))
    }
  }
  copy(sourceAssets, targetAssets)
}

export function buildSite({ outputDir = DEFAULT_OUTPUT_DIR } = {}) {
  const manifests = loadManifests()
  const documents = manifests.documents
    .map((entry) =>
      parseDocumentSource(entry.source, entry.sourcePath, [], manifests.examples, {
        render: false,
      }),
    )
    .sort(documentSort)
  const documentBySlug = new Map(documents.map((document) => [document.slug, document]))
  for (const entry of manifests.documents) {
    const document = documentBySlug.get(entry.slug)
    if (!document) fail(`文書を解析できません: ${entry.slug}`)
    if (document.section !== entry.section || document.order !== entry.order) {
      fail(`${entry.slug}: 文書一覧とfront matterの分類または順序が一致しません`)
    }
  }
  // 解析後の全見出しを渡してからリンクを組み立てるため、相互参照も同じ規則で検査する。
  for (const document of documents) {
    const reparsed = parseDocumentSource(
      document.source,
      document.sourcePath,
      documents,
      manifests.examples,
    )
    Object.assign(document, reparsed)
  }

  const stagingDir = `${outputDir}.staging-${process.pid}`
  mkdirSync(dirname(outputDir), { recursive: true })
  rmSync(stagingDir, { recursive: true, force: true })
  mkdirSync(stagingDir, { recursive: true })
  try {
    copyDocumentAssets(stagingDir)
    writeFileSync(join(stagingDir, 'index.html'), renderIndexPage(documents, manifests.examples))
    for (const document of documents) {
      const directory = join(stagingDir, document.slug)
      mkdirSync(directory, { recursive: true })
      const html = renderDetailPage(document, documents)
      writeFileSync(join(directory, 'index.html'), html)
      // Viteのpreviewと一般的な静的配信のclean URL解決の両方で末尾スラッシュなしを扱えるようにする。
      writeFileSync(join(stagingDir, `${document.slug}.html`), html)
    }
    writeFileSync(
      join(stagingDir, 'search-index.json'),
      JSON.stringify(renderSearchIndex(documents), null, 2) + '\n',
    )
    writeFileSync(
      join(stagingDir, 'examples.json'),
      JSON.stringify(
        manifests.examples.map(({ source, sourcePath: _sourcePath, sourceFile, ...example }) => ({
          ...example,
          version: SITE_VERSION,
          sourceFile,
          source,
        })),
        null,
        2,
      ) + '\n',
    )
    writeFileSync(join(stagingDir, 'search.js'), renderSearchScript())
    writeFileSync(
      join(stagingDir, 'site.css'),
      `${renderCss()}\n${readFileSync(SITE_HEADER_CSS_PATH, 'utf8')}`,
    )
    writeFileSync(
      join(stagingDir, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[
        '/',
        '/docs',
        ...documents.map((document) => `/docs/${document.slug}`),
      ]
        .map((path) => `  <url><loc>${escapeHtml(`${SITE_ORIGIN}${path}`)}</loc></url>`)
        .join('\n')}\n</urlset>\n`,
    )
    rmSync(outputDir, { recursive: true, force: true })
    renameSync(stagingDir, outputDir)
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true })
    throw error
  }
  return { documents, examples: manifests.examples, outputDir }
}

function run() {
  const checkOnly = process.argv.includes('--check')
  const outputDir = checkOnly
    ? join(tmpdir(), `irisout-site-check-${process.pid}`)
    : DEFAULT_OUTPUT_DIR
  try {
    const result = buildSite({ outputDir })
    console.log(
      `site: ${result.documents.length}件の文書と${result.examples.length}件の公式例を検査しました`,
    )
  } finally {
    if (checkOnly) rmSync(outputDir, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run()
