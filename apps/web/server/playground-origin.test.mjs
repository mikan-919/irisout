import assert from 'node:assert/strict'
import { test } from 'bun:test'
import {
  createControllerCsp,
  normalizeOrigin,
  validateSeparateOrigins,
} from '../src/playground/shared.js'

test('Originを正規化し、CSPへ値をそのまま注入しない', () => {
  assert.equal(normalizeOrigin('https://site.example/'), 'https://site.example')
  assert.throws(() => normalizeOrigin('https://site.example/path'), /Originだけ/)
  assert.throws(() => normalizeOrigin('https://site.example/%0d%0a'), /Originだけ/)
  const csp = createControllerCsp('https://site.example/')
  assert.match(csp, /frame-ancestors https:\/\/site\.example(?:;|$)/)
  assert.doesNotMatch(csp, /%0d|%0a|\\r|\\n/i)
})

test('公式Originと実行管理Originの同一hostnameを拒否する', () => {
  assert.throws(
    () => validateSeparateOrigins('https://site.example', 'https://site.example:444'),
    /異なるhostname/,
  )
  assert.deepEqual(validateSeparateOrigins('http://127.0.0.1:4173', 'http://localhost:4174'), {
    siteOrigin: 'http://127.0.0.1:4173',
    controllerOrigin: 'http://localhost:4174',
  })
})
