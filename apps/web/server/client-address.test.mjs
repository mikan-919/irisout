import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { parseTrustedProxyAddresses, resolveClientAddress } from './client-address.mjs'

test('直接接続ではX-Forwarded-Forを信用しない', () => {
  assert.equal(
    resolveClientAddress({
      socketAddress: '192.0.2.10',
      forwardedFor: '198.51.100.10',
    }),
    '192.0.2.10',
  )
})

test('信頼済みプロキシの検証済みX-Forwarded-Forだけを使う', () => {
  const trusted = parseTrustedProxyAddresses('192.0.2.1')
  assert.equal(
    resolveClientAddress({
      socketAddress: '192.0.2.1',
      forwardedFor: '198.51.100.10, 192.0.2.1',
      trustedProxyAddresses: trusted,
    }),
    '198.51.100.10',
  )
  assert.equal(
    resolveClientAddress({
      socketAddress: '192.0.2.1',
      forwardedFor: 'not-an-ip',
      trustedProxyAddresses: trusted,
    }),
    '192.0.2.1',
  )
})
