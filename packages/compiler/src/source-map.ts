import { GenMapping, addSegment, setSourceContent, toEncodedMap } from '@jridgewell/gen-mapping'
import type { DiagnosticOrigin } from './diagnostics.ts'

export interface SourceMapContext {
  filePath: string
  source: string
  origins?: DiagnosticOrigin[]
}

export interface IrisoutSourceMap {
  version: 3
  file?: string
  names: string[]
  sources: string[]
  sourcesContent: (string | null)[]
  mappings: string
}

const START = '/*#__IRISOUT_MAP_START_'
const END = '/*#__IRISOUT_MAP_END'
const MARKER = /\/\*#__IRISOUT_MAP_START_(\d+)__\*\/|\/\*#__IRISOUT_MAP_END(?:_(\d+))?__\*\//g

export function mappedSource(source: string, sourceStart: number, sourceEnd?: number): string {
  if (!source) return source
  return `${START}${sourceStart}__*/${source}${END}${sourceEnd == null ? '' : `_${sourceEnd}`}__*/`
}

export function stripSourceMapMarkers(source: string): string {
  return source.replace(MARKER, '')
}

function positionAt(source: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, source.length))
  const before = source.slice(0, safeOffset)
  const lastNewline = before.lastIndexOf('\n')
  return {
    line: before.split('\n').length - 1,
    column: safeOffset - lastNewline - 1,
  }
}

function resolveOriginal(
  context: SourceMapContext,
  offset: number,
): { filePath: string; source: string; line: number; column: number } {
  const origin = context.origins?.find(
    (candidate) => offset >= candidate.generatedStart && offset <= candidate.generatedEnd,
  )
  if (!origin) {
    return {
      filePath: context.filePath,
      source: context.source,
      ...positionAt(context.source, offset),
    }
  }
  const generatedBefore = context.source.slice(origin.generatedStart, offset)
  const generatedPosition = positionAt(generatedBefore, generatedBefore.length)
  const originalLines = origin.source.split('\n')
  const line = Math.min(generatedPosition.line, Math.max(0, originalLines.length - 1))
  const column = Math.min(generatedPosition.column, (originalLines[line] ?? '').length)
  return { filePath: origin.filePath, source: origin.source, line, column }
}

function advance(position: { line: number; column: number }, text: string): void {
  const lines = text.split('\n')
  if (lines.length === 1) {
    position.column += text.length
    return
  }
  position.line += lines.length - 1
  position.column = lines.at(-1)!.length
}

export function finalizeSourceMap(
  markedCode: string,
  context: SourceMapContext,
): { code: string; map: IrisoutSourceMap } {
  const map = new GenMapping()
  const generated = { line: 0, column: 0 }
  let code = ''
  let cursor = 0
  const positions: ReturnType<typeof resolveOriginal>[] = []

  for (const match of markedCode.matchAll(MARKER)) {
    const index = match.index
    const chunk = markedCode.slice(cursor, index)
    code += chunk
    const active = positions.at(-1)
    const lines = chunk.split('\n')
    if (active) {
      for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
        const generatedIndent = lines[lineIndex]!.match(/^\s*/)?.[0].length ?? 0
        const originalIndent =
          active.source.split('\n')[active.line + lineIndex]?.match(/^\s*/)?.[0].length ?? 0
        addSegment(
          map,
          generated.line + lineIndex,
          generatedIndent,
          active.filePath,
          active.line + lineIndex,
          originalIndent,
        )
      }
    }
    // 入れ子の本体を出力している間も、再開する外側の元位置を進める。
    for (const position of positions) {
      position.line += lines.length - 1
      if (lines.length === 1) position.column += chunk.length
      else {
        const lastLine = lines.at(-1)!
        const generatedIndent = lastLine.match(/^\s*/)?.[0].length ?? 0
        const originalIndent =
          position.source.split('\n')[position.line]?.match(/^\s*/)?.[0].length ?? 0
        position.column = originalIndent + lastLine.length - generatedIndent
      }
    }
    advance(generated, chunk)

    if (match[1] != null) {
      const position = resolveOriginal(context, Number(match[1]))
      positions.push(position)
      addSegment(
        map,
        generated.line,
        generated.column,
        position.filePath,
        position.line,
        position.column,
      )
      setSourceContent(map, position.filePath, position.source)
    } else {
      positions.pop()
      const position = positions.at(-1)
      if (position) {
        // 関数本体の再生成で改行が消えても、閉じ括弧の元位置から外側を再開する。
        if (match[2] != null) Object.assign(position, resolveOriginal(context, Number(match[2])))
        addSegment(
          map,
          generated.line,
          generated.column,
          position.filePath,
          position.line,
          position.column,
        )
      } else addSegment(map, generated.line, generated.column)
    }
    cursor = index + match[0].length
  }

  const tail = markedCode.slice(cursor)
  code += tail
  const encoded = toEncodedMap(map)
  return {
    code,
    map: {
      version: 3,
      ...(encoded.file ? { file: encoded.file } : {}),
      names: [...encoded.names],
      sources: encoded.sources.filter((source): source is string => source != null),
      sourcesContent: [...(encoded.sourcesContent ?? [])],
      mappings: encoded.mappings,
    },
  }
}
