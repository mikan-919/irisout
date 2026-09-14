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
