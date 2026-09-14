// 単一のJSX文字列をブラウザで変換する公開入口。
// Nodeのファイル読込みとmodule linkerを使う入口はclient build側に残し、
// Playgroundへ渡すsource-onlyの契約ではcompileだけを公開する。

import { compileBrowser as compileSource } from './compiler/source.ts'

export interface IrisoutSourceMap {
  readonly version: 3
  readonly file?: string
  readonly names: readonly string[]
  readonly sources: readonly string[]
  readonly sourcesContent: readonly (string | null)[]
  readonly mappings: string
}

export interface CompileResult {
  readonly code: string
  readonly map: IrisoutSourceMap
  readonly initialHtml: string
  readonly ssrCode?: string
  readonly markers: readonly unknown[]
  readonly signalToMarkers: ReadonlyMap<string, ReadonlySet<string>>
  readonly declName: ReadonlyMap<string, string>
  readonly dependencies: readonly string[]
}

export function compileBrowser(source: string): CompileResult {
  return compileSource(source) as unknown as CompileResult
}

export const compile = compileBrowser
