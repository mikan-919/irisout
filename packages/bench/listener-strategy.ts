#!/usr/bin/env bun
// 直接 addEventListener (ADR-0005 の想定: リストアイテムごとに個別リスナー)
// vs 1つの委譲リスナー (親要素で拾って event.target を見る) の、
// アタッチコストと dispatch コストを N 個の要素で比較するベンチマーク。
//
// 実行: bun run bench/listener-strategy.ts
//
// 注意: jsdom 上の歴史的な相対比較。実ブラウザの採否は
// listener-strategy.playwright.tsのChromium計測を使う。N=100000は数秒かかることがある。

import { JSDOM } from 'jsdom'

const SIZES = [100, 1_000, 10_000, 100_000]

interface Result {
  n: number
  attachMs: number
  dispatchMs: number
  heapDeltaKb: number
}

// GC を挟んでからヒープを測る - bun は --smol なしでも global.gc を
// 露出していないことがあるため、無ければ素の heapUsed 差分にフォールバック
// (ノイズが乗るので目安程度に見る)。
function heapUsedKb(): number {
  const g = globalThis as unknown as { gc?: () => void }
  g.gc?.()
  return process.memoryUsage().heapUsed / 1024
}

function benchDirect(n: number): Result {
  const dom = new JSDOM('<!doctype html><div id="root"></div>')
  const { document } = dom.window
  const root = document.getElementById('root')
  if (!root) throw new Error('root not found')

  const buttons: Element[] = []
  for (let i = 0; i < n; i++) {
    const btn = document.createElement('button')
    root.appendChild(btn)
    buttons.push(btn)
  }

  let clicks = 0
  const beforeKb = heapUsedKb()
  const t0 = performance.now()
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      clicks++
    })
  }
  const attachMs = performance.now() - t0
  const heapDeltaKb = heapUsedKb() - beforeKb

  const Event = dom.window.Event
  const t1 = performance.now()
  for (const btn of buttons) {
    btn.dispatchEvent(new Event('click', { bubbles: true }))
  }
  const dispatchMs = performance.now() - t1

  if (clicks !== n) throw new Error(`direct: expected ${n} clicks, got ${clicks}`)
  return { n, attachMs, dispatchMs, heapDeltaKb }
}

function benchDelegated(n: number): Result {
  const dom = new JSDOM('<!doctype html><div id="root"></div>')
  const { document } = dom.window
  const root = document.getElementById('root')
  if (!root) throw new Error('root not found')

  const buttons: Element[] = []
  for (let i = 0; i < n; i++) {
    const btn = document.createElement('button')
    root.appendChild(btn)
    buttons.push(btn)
  }

  let clicks = 0
  const beforeKb = heapUsedKb()
  const t0 = performance.now()
  root.addEventListener('click', (e) => {
    if ((e.target as Element).tagName === 'BUTTON') clicks++
  })
  const attachMs = performance.now() - t0
  const heapDeltaKb = heapUsedKb() - beforeKb

  const Event = dom.window.Event
  const t1 = performance.now()
  for (const btn of buttons) {
    btn.dispatchEvent(new Event('click', { bubbles: true }))
  }
  const dispatchMs = performance.now() - t1

  if (clicks !== n) throw new Error(`delegated: expected ${n} clicks, got ${clicks}`)
  return { n, attachMs, dispatchMs, heapDeltaKb }
}

console.log('直接 addEventListener (アイテムごと) vs 委譲 (親1個)')
console.log('(--smol なしだと global.gc が無く、ヒープ差分はノイズが乗る目安値)\n')
console.log(
  'N'.padEnd(10),
  'direct attach (ms)'.padEnd(20),
  'direct dispatch (ms)'.padEnd(22),
  'direct heap (KB)'.padEnd(18),
  'delegated attach (ms)'.padEnd(23),
  'delegated dispatch (ms)'.padEnd(25),
  'delegated heap (KB)',
)
for (const n of SIZES) {
  const d = benchDirect(n)
  const g = benchDelegated(n)
  console.log(
    String(n).padEnd(10),
    d.attachMs.toFixed(2).padEnd(20),
    d.dispatchMs.toFixed(2).padEnd(22),
    d.heapDeltaKb.toFixed(1).padEnd(18),
    g.attachMs.toFixed(2).padEnd(23),
    g.dispatchMs.toFixed(2).padEnd(25),
    g.heapDeltaKb.toFixed(1),
  )
}
