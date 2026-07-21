import { describe, expect, it } from 'bun:test'
import { compile } from '../src/compiler.js'

// scope-limit-coverage: 非対応のトップレベル構文・宣言子形状が生の実行時
// エラー(ReferenceError 等)ではなく `compile:` エラーで拒否されることを
// 検証する(openspec: compile-error-coverage)。

describe('compile-error-coverage: 分割代入宣言子の明示拒否', () => {
  it('const [a] = signal(0) は scope limit で拒否される', () => {
    const source = `
export function Counter() {
  const [a] = signal(0);
  render(<div>{a()}</div>);
}
`
    expect(() => compile(source)).toThrow(/^compile:.*\(scope limit\)/)
  })
})

describe('compile-error-coverage: コンポーネント外トップレベル文の明示拒否', () => {
  it('コンポーネント外の const TAX = 1.1 は scope limit で拒否される', () => {
    const source = `
const TAX = 1.1;
export function Counter() {
  const count = signal(0);
  render(<div>{count() * TAX}</div>);
}
`
    expect(() => compile(source)).toThrow(/^compile:.*\(scope limit\)/)
  })
})

describe('compile-error-coverage: ビルド時実行エラーのラップ', () => {
  it('ビルド時実行で throw するソースは compile: で始まり cause を持つ', () => {
    // 構文検査は通過する(signal 呼び出しの引数式)が、ビルド時実行で
    // JSON.parse が SyntaxError を throw するソース。
    const source = `
export function Counter() {
  const count = signal(JSON.parse("{"));
  render(<div>{count()}</div>);
}
`
    let caught: unknown
    try {
      compile(source)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    const err = caught as Error
    expect(err.message).toMatch(/^compile: build-time execution failed:/)
    expect(err.cause).toBeInstanceOf(Error)
  })
})
