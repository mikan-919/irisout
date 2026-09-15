// Nodeのファイル読込みを伴う既存のコンパイラ公開入口。
// 単一sourceの解析本体はcompiler/source.tsへ分離し、browser入口が
// module linkerとNode組込みを梱包しないようにする。

import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  compile,
  compileSource,
  compileSSR,
  type CompileOptions,
  type CompileResult,
} from './compiler/source.ts'
import { linkProject } from './compiler/module-linker.ts'
import { withCompileDiagnostic } from './diagnostics.ts'
import type { DiagnosticOrigin } from './diagnostics.ts'

export { compile, compileSSR }
export { CompileDiagnostic } from './diagnostics.ts'
export type { CompileResult } from './compiler/source.ts'

// authored JSXからだけ使う、コンパイル時に消える記述API。実行時にこの関数が
// 呼ばれた場合は、Vite連携またはcompile()を通さずに実行していることを示す。
export interface IrisSignal<T> {
  (): T
  (next: T | ((previous: T) => T)): T
}

export interface IrisContext<T> {
  readonly __irisoutContextType?: T
}

export interface IrisAsyncContext<T> extends IrisContext<PromiseLike<T>> {}

function authoringOnly(name: string): never {
  throw new Error(`irisout ${name}() is only available in compiled authored JSX`)
}

// JSX.Elementと同じく、値を返さないcomponentとhost要素の両方を受ける。
// biome-ignore lint/suspicious/noConfusingVoidType: JSXの値なしcomponentを表す公開型
type IrisAuthoringElement = void | object

export function signal<T>(_initial: T): IrisSignal<T> {
  return authoringOnly('signal')
}

export function derived<T>(_compute: () => T): () => T {
  return authoringOnly('derived')
}

export function render(_element: IrisAuthoringElement): void {
  authoringOnly('render')
}

// biome-ignore lint/suspicious/noConfusingVoidType: cleanupなしを表す公開記述APIの型
export function onMount(_callback: () => void | (() => void)): void {
  authoringOnly('onMount')
}

// biome-ignore lint/suspicious/noConfusingVoidType: cleanupなしを表す公開記述APIの型
export function effect(_callback: () => void | (() => void)): void {
  authoringOnly('effect')
}

export function createContext<T>(_defaultValue: T): IrisContext<T> {
  return authoringOnly('createContext')
}

export function createAsyncContext<T>(_defaultValue: PromiseLike<T>): IrisAsyncContext<T> {
  return authoringOnly('createAsyncContext')
}

export function provideContext<T>(_context: IrisContext<T>, _value: T): void {
  authoringOnly('provideContext')
}

export function useContext<T>(_context: IrisContext<T>): T {
  return authoringOnly('useContext')
}

export interface CompileProjectOptions {
  /** clientは既存入口、ssrは要求単位のrender moduleを追加生成する。 */
  target?: 'client' | 'ssr'
}

// Node側のbuild入口。module graphの読込はここで行い、既存compile(source)の
// 単一文字列APIとsource-onlyテストを変更しない。Vite pluginはentry pathだけを
// 渡し、リンク済みsourceや補助宣言を直接扱わない。
export function compileProject(
  entryPath: string,
  projectOptions: CompileProjectOptions = {},
): CompileResult {
  const diagnosticFilePath = path.resolve(entryPath)
  let diagnosticSource = ''
  let diagnosticOrigins: DiagnosticOrigin[] | undefined
  try {
    diagnosticSource = readFileSync(diagnosticFilePath, 'utf8')
    const linked = linkProject(entryPath)
    diagnosticSource = linked.source
    diagnosticOrigins = linked.origins
    const options: CompileOptions = {
      allowModuleSupport: true,
      target: projectOptions.target,
      hasRelativeModule: linked.hasRelativeModule,
      supportStatements: linked.supportStatements,
      supportNames: linked.supportNames,
      externalImports: linked.externalImports,
      dependencies: linked.dependencies,
      sourceMapFilePath: diagnosticFilePath,
      sourceMapOrigins: linked.origins,
    }
    return compileSource(linked.source, options)
  } catch (error) {
    throw withCompileDiagnostic(error, {
      filePath: diagnosticFilePath,
      source: diagnosticSource,
      origins: diagnosticOrigins,
    })
  }
}
