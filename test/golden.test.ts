import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { compile } from '../src/compiler.js'

// 生成コードの「形」と「サイズ」の退行を検出する観測専用スイート
// (openspec: golden-output-snapshot-tests)。プロダクトコード(src/**)は
// 一切変更しない ― 出力の形が気に入らなくてもそのまま記録する。
//
// ■ スナップショット更新の運用規則
//   スナップショットが落ちたとき、それが「意図した codegen 変更」なら
//   `bun test test/golden.test.ts --update-snapshots` で更新し、生成された
//   diff を必ずレビューに含めること。意図していない変化なら退行であり、
//   更新してはならない。diff を見ずに機械的に --update-snapshots を叩くのは
//   このスイートの存在意義を無にする行為。

// M1: signal + derived の counter(test/counter.test.ts の COUNTER_SOURCE の
// コピー)。既存テストへの import 依存を作らないため、あえて複製している。
const M1_SOURCE = `
export function Counter() {
  const count = signal(0);
  const doubled = derived(() => count() * 2);
  render(<div>{count() + doubled()}</div>);
}
`

// M2: onClick ハンドラ付き counter(test/handlers.test.ts の COUNTER_SOURCE の
// コピー)。
const M2_SOURCE = `
export function Counter() {
  const count = signal(0);
  const doubled = derived(() => count() * 2);
  render(
    <div>
      <span>{count() + doubled()}</span>
      <button onClick={() => count(count() + 1)}>+</button>
    </div>
  );
}
`

// ADR-0009: ブロック本体ハンドラ(第1引数あり・4文種を含む)の code を固定する。
const ADR0009_SOURCE = `
export function Counter() {
  const count = signal(0);
  render(
    <div>
      <span>{count()}</span>
      <button onClick={inc}>+</button>
    </div>
  );
  function inc(e) {
    if (e.detail > 1) return;
    const n = count() + 1;
    count(n);
  }
}
`

describe('golden: 生成コードの構造スナップショット', () => {
  it('M1 フィクスチャの code と initialHtml を固定する', () => {
    const { code, initialHtml } = compile(M1_SOURCE)
    expect(code).toMatchSnapshot()
    expect(initialHtml).toMatchSnapshot()
  })

  it('M2 フィクスチャの code を固定する', () => {
    const { code } = compile(M2_SOURCE)
    expect(code).toMatchSnapshot()
  })

  it('ADR-0009 ブロック本体ハンドラの code を固定する', () => {
    const { code } = compile(ADR0009_SOURCE)
    expect(code).toMatchSnapshot()
  })
})

describe('golden: コンパイルの決定論', () => {
  it('同一ソースを2回 compile した code は完全一致する', () => {
    const a = compile(M2_SOURCE)
    const b = compile(M2_SOURCE)
    expect(a.code).toBe(b.code)
  })
})

describe('golden: signal/derived ラッパー非混入(ADR-0006 回帰チェック)', () => {
  it('記録済みスナップショットに signal( / derived( が現れない', () => {
    const m1 = compile(M1_SOURCE).code
    const m2 = compile(M2_SOURCE).code
    for (const code of [m1, m2]) {
      expect(code).not.toContain('signal(')
      expect(code).not.toContain('derived(')
    }
  })
})

describe('golden: 手書き基準に対するサイズ予算', () => {
  it('dist/app.js は手書き基準(examples/counter.handwritten.js)の4倍以内', () => {
    const result = spawnSync('bun', [
      'scripts/build.ts',
      'examples/counter.jsx',
    ])
    expect(result.status).toBe(0)

    // 分母はコメント行・空行を除いた手書きコードの byteLength。
    const handwritten = readFileSync('examples/counter.handwritten.js', 'utf8')
    const baselineBytes = Buffer.byteLength(
      handwritten
        .split('\n')
        .filter((line) => {
          const t = line.trim()
          return t !== '' && !t.startsWith('//')
        })
        .join('\n'),
      'utf8',
    )

    const appBytes = statSync('dist/app.js').size
    const ratio = appBytes / baselineBytes
    // 退行の兆候を早期に可視化するため実測比を出力する(係数を締めるのは M6)。
    // 2026-07-18: hydration-marker-verification のランタイム検証(固定費)で
    // 3x を超えたため 4x へ引き上げ(loud-hydration-mismatch の spec delta 参照。
    // 生成コード側の肥大化ではない)。
    console.log(
      `[size budget] dist/app.js=${appBytes}B / handwritten=${baselineBytes}B = ${ratio.toFixed(2)}x (budget 4x)`,
    )

    expect(appBytes).toBeLessThanOrEqual(baselineBytes * 4)
  })
})
