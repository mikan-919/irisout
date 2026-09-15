// Bunの接続元を頻度制限へ渡す。Forwarded系ヘッダーは信頼済みプロキシ経由だけで使う。
import { isIP } from 'node:net'

export function parseTrustedProxyAddresses(value = '') {
  if (typeof value !== 'string' || value.trim() === '') return new Set()
  const addresses = value.split(',').map((entry) => normalizeIp(entry.trim()))
  if (addresses.some((address) => address === null)) {
    throw new Error('IRISOUT_TRUSTED_PROXYにはIPアドレスだけを指定してください')
  }
  return new Set(addresses)
}

export function resolveClientAddress({
  socketAddress,
  forwardedFor,
  trustedProxyAddresses = new Set(),
} = {}) {
  const socketIp = normalizeIp(socketAddress)
  if (!socketIp) return null
  if (!trustedProxyAddresses.has(socketIp)) return socketIp
  if (typeof forwardedFor !== 'string' || forwardedFor.trim() === '') return socketIp

  const chain = forwardedFor.split(',').map((entry) => normalizeIp(entry.trim()))
  return chain.every((address) => address !== null) ? chain[0] : socketIp
}

function normalizeIp(value) {
  return typeof value === 'string' && isIP(value) > 0 ? value : null
}
