// compileProject()をViteのHTML変換・仮想module・開発時再読込へ接続する。
// compilerが読み込んだ依存pathを監視対象として使い、入口や相対moduleの編集時に
// 初期HTMLとhydrate用JavaScriptを同じ結果から作り直す。汎用のHMR差分更新や
// 状態保持はこの連携のスコープ外で、更新時はページ全体を再読み込みする。

import path from 'node:path'
import { compileProject, type CompileResult } from '@irisout/compiler'
import type { HmrContext, Plugin, ResolvedConfig } from 'vite-plus'

const DEFAULT_VIRTUAL_MODULE_ID = 'virtual:irisout-entry'
const DEFAULT_HTML_MARKER = '<!--irisout-html-->'
const DEFAULT_CONTAINER = '#app'

export interface IrisoutPluginOptions {
  /** Viteのrootから解決する入口。絶対pathも受け付ける。 */
  entry: string
  /** 初期HTMLを埋め込む場所とhydrate対象を示すCSS selector。 */
  container?: string
  /** index.html内で初期HTMLを置き換える文字列。 */
  htmlMarker?: string
  /** main.jsからimportする仮想module名。 */
  virtualModuleId?: string
}

function normalizePath(filePath: string): string {
  return path.normalize(path.resolve(filePath))
}

/**
 * authored JSXをcompileProject()で生成し、Viteの標準module graphへ渡す連携。
 * compilerの実行はビルド時と入口・依存のHMR時だけで、ブラウザへはhydrate用の
 * 生成moduleと初期HTMLを渡す。
 */
export function irisout(options: IrisoutPluginOptions): Plugin {
  const virtualModuleId = options.virtualModuleId ?? DEFAULT_VIRTUAL_MODULE_ID
  const htmlMarker = options.htmlMarker ?? DEFAULT_HTML_MARKER
  const containerSelector = options.container ?? DEFAULT_CONTAINER

  let root = process.cwd()
  let entryPath = normalizePath(path.resolve(root, options.entry))
  // NUL始まりの仮想識別子はVite+の本番ビルドで変換地図の入力元から除かれる。
  // Vite root内の仮想pathを使い、通常のmoduleとして地図とpackage解決を連鎖させる。
  let resolvedVirtualModuleId = path.join(
    root,
    `.irisout-${encodeURIComponent(virtualModuleId)}.js`,
  )
  let result: CompileResult | null = null
  let dependencies = new Set<string>()

  const compile = (): CompileResult => {
    const next = compileProject(entryPath)
    result = next
    dependencies = new Set(next.dependencies.map(normalizePath))
    return next
  }

  const ensureCompiled = (): CompileResult => result ?? compile()

  const watch = (add: (filePath: string) => void): void => {
    for (const filePath of dependencies) add(filePath)
  }

  const hydrateSource = (): string => {
    if (containerSelector === '#app') {
      return "hydrateComponent(document.getElementById('app'));"
    }
    const selector = JSON.stringify(containerSelector)
    const message = JSON.stringify(`irisout hydrate container not found: ${containerSelector}`)
    return [
      `const __irisout_container__ = document.querySelector(${selector});`,
      `if (!__irisout_container__) throw new Error(${message});`,
      'hydrateComponent(__irisout_container__);',
    ].join('\n')
  }

  return {
    name: 'irisout',
    configResolved(config: ResolvedConfig) {
      root = config.root
      entryPath = normalizePath(path.resolve(root, options.entry))
      resolvedVirtualModuleId = path.join(
        root,
        `.irisout-${encodeURIComponent(virtualModuleId)}.js`,
      )
      result = null
      dependencies = new Set()
    },
    buildStart() {
      compile()
      watch((filePath) => this.addWatchFile(filePath))
    },
    configureServer(server) {
      const current = ensureCompiled()
      server.watcher.add([...current.dependencies])
    },
    resolveId(id: string) {
      return id === virtualModuleId ? resolvedVirtualModuleId : null
    },
    load(id: string) {
      if (id !== resolvedVirtualModuleId) return null
      const current = ensureCompiled()
      return {
        code: `${current.code}\n${hydrateSource()}`,
        map: current.map,
      }
    },
    transformIndexHtml(html: string) {
      if (!html.includes(htmlMarker)) return html
      return html.replaceAll(htmlMarker, ensureCompiled().initialHtml)
    },
    async handleHotUpdate(context: HmrContext) {
      const changedPath = normalizePath(context.file)
      if (dependencies.size === 0) ensureCompiled()
      if (!dependencies.has(changedPath)) return

      const previous = result
      try {
        const current = compile()
        context.server.watcher.add([...current.dependencies])
      } catch (error) {
        // 直前の正常な生成物を保持する。Viteがエラー画面を表示した後、修正された
        // 次の変更でこの値を更新できるため、構文エラーで監視を失わない。
        result = previous
        throw error
      }
      context.server.ws.send({ type: 'full-reload', path: '*' })
      return []
    },
  }
}

export default irisout
