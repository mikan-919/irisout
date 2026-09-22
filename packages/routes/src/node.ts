// `page.tsx`と`page.jsx`のディレクトリ規約をNodeで走査し、ブラウザーへ渡せる情報と
// サーバーだけが使うpage file pathを持つ共通経路表を作る。

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  createRouteDefinition,
  createRouteTable,
  type RouteDefinition,
  type RouteTable,
} from './index.ts'

export interface FileRouteDefinition extends RouteDefinition {
  readonly filePath: string
}

export interface FileRouteManifest extends RouteTable<FileRouteDefinition> {
  readonly rootDirectory: string
  readonly dependencies: readonly string[]
}

function routePathFromDirectory(rootDirectory: string, directory: string): string {
  const relative = path.relative(rootDirectory, directory)
  if (!relative) return '/'
  const segments = relative.split(path.sep)
  const routeSegments = segments.map((segment) => {
    const dynamic = /^\[([^[\]]+)\]$/.exec(segment)
    if (dynamic) return `:${dynamic[1]}`
    if (segment.includes('[') || segment.includes(']')) {
      throw new Error(
        `compile: unsupported route directory segment "${segment}" in "${directory}" (scope limit)`,
      )
    }
    return segment
  })
  return `/${routeSegments.join('/')}`
}

function walk(directory: string, visit: (filePath: string) => void): void {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  const pages = entries.filter(
    (entry) => entry.isFile() && (entry.name === 'page.tsx' || entry.name === 'page.jsx'),
  )
  if (pages.length > 1) {
    throw new Error(
      `compile: route directory "${directory}" contains both page.tsx and page.jsx (scope limit)`,
    )
  }
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      walk(filePath, visit)
    } else if (pages[0]?.name === entry.name) {
      visit(filePath)
    }
  }
}

/** 指定ディレクトリの現在の`page.tsx`または`page.jsx`から経路を作り直す。 */
export function scanFileRoutes(directory: string): FileRouteManifest {
  const rootDirectory = path.resolve(directory)
  let isDirectory = false
  try {
    isDirectory = statSync(rootDirectory).isDirectory()
  } catch {
    isDirectory = false
  }
  if (!isDirectory) {
    throw new Error(`compile: route directory "${rootDirectory}" does not exist (scope limit)`)
  }

  const definitions: FileRouteDefinition[] = []
  walk(rootDirectory, (filePath) => {
    const routePath = routePathFromDirectory(rootDirectory, path.dirname(filePath))
    const definition = createRouteDefinition(routePath, routePath, path.resolve(filePath))
    definitions.push({ ...definition, filePath: path.resolve(filePath) })
  })
  const table = createRouteTable(definitions)
  return {
    rootDirectory,
    basePath: table.basePath,
    routes: table.routes,
    dependencies: table.routes.map((route) => route.filePath),
  }
}

export const createFileRouteManifest = scanFileRoutes
export const generateFileRoutes = scanFileRoutes
