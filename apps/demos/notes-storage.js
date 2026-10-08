const STORAGE_KEY = 'irisout-verification-logs'

export function loadVerificationLogs() {
  try {
    const saved = globalThis.localStorage.getItem(STORAGE_KEY)
    if (saved === null) return { ok: true, value: [] }
    const value = JSON.parse(saved)
    if (!Array.isArray(value)) return { ok: false, value: [] }
    return { ok: true, value }
  } catch {
    return { ok: false, value: [] }
  }
}

export function saveVerificationLogs(value) {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
