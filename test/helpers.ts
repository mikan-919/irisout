import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { JSDOM } from 'jsdom'

// 手作りのフェイクではなく(jsdom による)実 DOM を使う:将来のマイルストーン
// (条件分岐/リスト)がコメントノードのアンカーや nextSibling の帳簿付けを
// 必要とするため、それを手で忠実に再現するのは HTML パーサーの再実装になる。
export function createContainer(): Element {
  const dom = new JSDOM('<!doctype html><div id="app"></div>')
  const el = dom.window.document.getElementById('app')
  if (!el) throw new Error('createContainer: #app not found')
  return el
}

export async function loadGenerated(
  code: string,
): Promise<Record<string, unknown>> {
  const runtimePath = JSON.stringify(path.join(process.cwd(), 'src/runtime.ts'))
  const file = path.join(tmpdir(), `irisout-${Date.now()}-${Math.random()}.mjs`)
  writeFileSync(file, code.replace("'../src/runtime.js'", runtimePath))
  return import(file)
}
