// テンプレートリテラルのソース文字列を組み立てるヘルパー群。
// コンパイラの render ウォークと最終 codegen (src/codegen.ts) の両方から使う。

import type { ContentPart } from './compiler/state.js'

// JSX の空白ルール(Babel の cleanJSXElementLiteralChild と同じ): 改行を
// 挟む行はインデント/末尾空白を落として1スペースで詰め直す。単一行の
// テキスト(式の間のインライン空白など)はそのまま保持する。
export function cleanJSXText(value: string): string {
  if (!/\r\n|\n|\r/.test(value)) return value
  const lines = value.split(/\r\n|\n|\r/)
  let lastNonEmptyLine = 0
  for (let i = 0; i < lines.length; i++) {
    if (/[^ \t]/.test(lines[i] ?? '')) lastNonEmptyLine = i
  }
  let result = ''
  for (let i = 0; i < lines.length; i++) {
    let line = (lines[i] ?? '').replace(/\t/g, ' ')
    if (i !== 0) line = line.replace(/^ +/, '')
    if (i !== lines.length - 1) line = line.replace(/ +$/, '')
    if (line) {
      if (i !== lastNonEmptyLine) line += ' '
      result += line
    }
  }
  return result
}

export function escapeTemplateText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
}

// HTML 属性値として埋め込むためのエスケープ。escapeTemplateText の
// テンプレートリテラル安全性(バックスラッシュ・バッククォート・${)に加え、
// 二重引用符で囲むための "&" と "\"" もエンティティ化する。
export function escapeAttrValue(value: string): string {
  return escapeTemplateText(
    value.replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
  )
}

// 静的ホスト属性。文字列値を持つものと、値なし真偽属性(disabled 等)を
// 型で区別する(design.md 決定4: valueless を ="true" と誤出力しない)。
export type StaticAttr =
  | { name: string; value: string }
  | { name: string; valueless: true }

// 静的属性を開始タグへ差し込む文字列に変換する。文字列値は
// ` name="escaped"`、値なし属性は ` name` を返し、全て連結する。
export function renderStaticAttrs(attrs: StaticAttr[]): string {
  return attrs
    .map((attr) =>
      'valueless' in attr
        ? ` ${attr.name}`
        : ` ${attr.name}="${escapeAttrValue(attr.value)}"`,
    )
    .join('')
}

// ADR-0012 決定2: 動的属性バインディングの attribute/property 使い分けの
// 固定表。実需(TodoMVC パリティ)の最小限のみ — 広げるときは ADR-0012 に
// 追記する。render.ts(焼き込み)と codegen.ts(更新行)の両方から使う。
// ponytail: checked/value の2エントリのみ、disabled等は実需が出たら追加。
export type AttrBindingKind = 'boolProp' | 'prop' | 'attr'

export function attrBindingKind(name: string): AttrBindingKind {
  if (name === 'checked') return 'boolProp'
  if (name === 'value') return 'prop'
  return 'attr'
}

// contentParts -> テンプレートリテラルの*内側*のソーステキスト(バッククォートなし)。
export function innerTemplateSource(contentParts: ContentPart[]): string {
  return contentParts
    .map((part) =>
      part.type === 'text'
        ? escapeTemplateText(part.value)
        : `\${${part.code}}`,
    )
    .join('')
}

// 条件分岐のブランチをテンプレートリテラルに埋め込む形:実マークアップか、
// 何も描画しないブランチなら空のプレースホルダ `<!---->`。(M5 で使用予定)
export function embedBranch(html: string | null): string {
  return html !== null ? `\`${html}\`` : '`<!---->`'
}
