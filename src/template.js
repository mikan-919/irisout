// テンプレートリテラルのソース文字列を組み立てるヘルパー群。
// コンパイラの render ウォークと最終 codegen (src/codegen.js) の両方から使う。

export function escapeTemplateText(text) {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

// contentParts -> テンプレートリテラルの*内側*のソーステキスト(バッククォートなし)。
export function innerTemplateSource(contentParts) {
  return contentParts
    .map((part) => (part.type === 'text' ? escapeTemplateText(part.value) : '${' + part.code + '}'))
    .join('');
}

// 条件分岐のブランチをテンプレートリテラルに埋め込む形:実マークアップか、
// 何も描画しないブランチなら空のプレースホルダ `<!---->`。
export function embedBranch(html) {
  return html !== null ? `\`${html}\`` : '`<!---->`';
}
