export interface DiagnosticOptions {
  filePath: string
  source: string
  offset?: number
  /** compileProject()の連結後ソースを元モジュールへ戻す範囲。 */
  origins?: DiagnosticOrigin[]
}

export interface DiagnosticOrigin {
  generatedStart: number
  generatedEnd: number
  filePath: string
  source: string
}

export interface DiagnosticPosition {
  filePath: string
  line: number
  column: number
}

interface SourceLocationLike {
  line?: unknown
  column?: unknown
  index?: unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function sourcePosition(source: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, source.length))
  const before = source.slice(0, safeOffset)
  const line = before.split('\n').length
  const lastNewline = before.lastIndexOf('\n')
  return { line, column: safeOffset - lastNewline }
}

function sourceOffset(source: string, line: number, column: number): number {
  if (line <= 1) return Math.max(0, column - 1)
  let offset = 0
  let currentLine = 1
  while (currentLine < line) {
    const next = source.indexOf('\n', offset)
    if (next < 0) return source.length
    offset = next + 1
    currentLine += 1
  }
  return Math.min(source.length, offset + Math.max(0, column - 1))
}

function mapOrigin(
  source: string,
  line: number,
  column: number,
  origins: DiagnosticOrigin[] | undefined,
): DiagnosticPosition | null {
  if (!origins || origins.length === 0) return null
  const generatedOffset = sourceOffset(source, line, column)
  const origin = origins.find(
    (candidate) =>
      generatedOffset >= candidate.generatedStart && generatedOffset <= candidate.generatedEnd,
  )
  if (!origin) return null
  const relativeOffset = Math.max(0, generatedOffset - origin.generatedStart)
  const generatedBefore = source.slice(origin.generatedStart, generatedOffset)
  const relativeLine = generatedBefore.split('\n').length
  const originalLines = origin.source.split('\n')
  const originalLine = Math.min(Math.max(1, relativeLine), Math.max(1, originalLines.length))
  const originalLineText = originalLines[originalLine - 1] ?? ''
  const originalColumn = Math.min(
    Math.max(1, relativeLine === 1 ? relativeOffset : generatedBefore.lastIndexOf('\n') + 1),
    Math.max(1, originalLineText.length + 1),
  )
  return { filePath: origin.filePath, line: originalLine, column: originalColumn }
}

function locationFromValue(
  value: unknown,
  source: string,
): { line: number; column: number } | null {
  const outer = asRecord(value)
  const record = (asRecord(outer?.start) ?? outer) as SourceLocationLike | null
  if (!record) return null
  const line = typeof record.line === 'number' ? record.line : null
  const column = typeof record.column === 'number' ? record.column : null
  if (line != null && column != null) {
    return { line: Math.max(1, line), column: Math.max(1, column + 1) }
  }
  return typeof record.index === 'number' ? sourcePosition(source, record.index) : null
}

function locationFromError(
  error: unknown,
  source: string,
): { line: number; column: number } | null {
  const seen = new Set<object>()
  let current: unknown = error
  while (current != null) {
    const record = asRecord(current)
    if (!record) return null
    if (seen.has(record)) return null
    seen.add(record)
    const location = locationFromValue(record.loc, source)
    if (location) return location
    current = record.cause
  }
  return null
}

function findQuotedSourceOffset(message: string, source: string): number | null {
  const quoted = /["'`]([^"'`\n]+)["'`]/g
  for (const match of message.matchAll(quoted)) {
    const candidate = match[1]
    if (!candidate || candidate.length < 2) continue
    const offset = source.indexOf(candidate)
    if (offset >= 0) return offset
  }
  return null
}

export function diagnosticPosition(error: unknown, options: DiagnosticOptions): DiagnosticPosition {
  const location =
    options.offset != null
      ? sourcePosition(options.source, options.offset)
      : (locationFromError(error, options.source) ??
        sourcePosition(
          options.source,
          findQuotedSourceOffset(
            error instanceof Error ? error.message : String(error),
            options.source,
          ) ?? 0,
        ))
  return (
    mapOrigin(options.source, location.line, location.column, options.origins) ?? {
      filePath: options.filePath,
      ...location,
    }
  )
}

export class CompileDiagnostic extends Error {
  readonly filePath: string
  readonly line: number
  readonly column: number

  constructor(message: string, options: DiagnosticOptions, cause?: unknown) {
    const normalized = message.startsWith('compile:') ? message : `compile: ${message}`
    const position = diagnosticPosition(cause ?? message, options)
    super(`${normalized} [${position.filePath}:${position.line}:${position.column}]`, { cause })
    this.name = 'CompileDiagnostic'
    this.filePath = position.filePath
    this.line = position.line
    this.column = position.column
  }
}

export function withCompileDiagnostic(
  error: unknown,
  options: DiagnosticOptions,
): CompileDiagnostic {
  if (error instanceof CompileDiagnostic) return error
  const message = error instanceof Error ? error.message : String(error)
  return new CompileDiagnostic(message, options, error)
}
