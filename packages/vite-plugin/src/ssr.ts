// `irisout/ssr`の公開境界。SSRの設定pluginとstate搬送だけを公開し、client用の
// `irisout/vite`入口へ要求単位のserver処理を混ぜない。

export { irisoutSsr, type IrisoutSsrPluginOptions } from './index.ts'

export type IrisoutJsonValue =
  | null
  | boolean
  | number
  | string
  | IrisoutJsonValue[]
  | { [key: string]: IrisoutJsonValue }

export interface IrisoutSsrState {
  readonly __irisout_state__: true
  readonly input: IrisoutJsonValue
  readonly signals: Readonly<Record<string, IrisoutJsonValue>>
}

export interface IrisoutSsrResult {
  readonly html: string
  readonly state: IrisoutSsrState
}

function assertJsonValue(value: unknown, seen: Set<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('SSR state must contain finite JSON numbers')
    return
  }
  if (typeof value !== 'object') throw new TypeError('SSR state must contain JSON values')

  if (seen.has(value)) throw new TypeError('SSR state must not contain cycles')
  seen.add(value)
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError('SSR state must contain ordinary arrays')
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue
      if (
        typeof key !== 'string' ||
        !/^(0|[1-9][0-9]*)$/.test(key) ||
        Number(key) >= value.length
      ) {
        throw new TypeError('SSR state arrays must contain indexed values only')
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !descriptor.enumerable || descriptor.get || descriptor.set) {
        throw new TypeError('SSR state must contain data properties only')
      }
      assertJsonValue(value[Number(key)], seen)
    }
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('SSR state must contain plain JSON objects')
    }
    const record = value as Record<string, unknown>
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string')
        throw new TypeError('SSR state must not contain symbol properties')
      if (key === 'toJSON') throw new TypeError('SSR state must not contain toJSON properties')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !descriptor.enumerable || descriptor.get || descriptor.set) {
        throw new TypeError('SSR state must contain data properties only')
      }
      assertJsonValue(record[key], seen)
    }
  }
  seen.delete(value)
}

/** JSON stateをscript要素へ安全に埋め込める文字列へ変換する。 */
export function serializeSsrState(value: unknown): string {
  assertJsonValue(value, new Set())
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new TypeError('SSR state must contain JSON values')
  return encoded.replace(/[<>&\u2028\u2029]/g, (character) => {
    if (character === '<') return '\\u003C'
    if (character === '>') return '\\u003E'
    if (character === '&') return '\\u0026'
    if (character === '\u2028') return '\\u2028'
    return '\\u2029'
  })
}
