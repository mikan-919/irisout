// 純粋な AST 分類器:コンパイラが構造ユニット(条件分岐・keyed リスト)として
// 扱う JSX 式の形を認識する。コンパイラの状態には触れず、Babel のパス
// (とアイテムテンプレート用の生ソース)だけを見る。

import { escapeTemplateText } from './template.js';

// `cond && <A/>`(falsy 側なし=何も描画しない)または `cond ? <A/> : <B/>`。
export function classifyConditionalExpr(exprPath) {
  if (exprPath.isLogicalExpression({ operator: '&&' })) {
    return { conditionPath: exprPath.get('left'), truthyPath: exprPath.get('right'), falsyPath: null };
  }
  if (exprPath.isConditionalExpression()) {
    return { conditionPath: exprPath.get('test'), truthyPath: exprPath.get('consequent'), falsyPath: exprPath.get('alternate') };
  }
  return null;
}

// `things().map(item => <li key={item.id}>...</li>)`、concise / block ボディ両対応。
export function classifyListExpr(exprPath) {
  if (!exprPath.isCallExpression() || exprPath.node.arguments.length !== 1) return null;
  const callee = exprPath.get('callee');
  if (!callee.isMemberExpression() || callee.node.computed || callee.node.property.name !== 'map') return null;
  const callback = exprPath.get('arguments.0');
  if (!callback.isArrowFunctionExpression() || callback.node.params.length !== 1 || callback.node.params[0].type !== 'Identifier') return null;
  let templatePath = callback.get('body');
  if (templatePath.isBlockStatement()) {
    const ret = templatePath.get('body').find((s) => s.isReturnStatement());
    if (!ret) return null;
    templatePath = ret.get('argument');
  }
  if (!templatePath.isJSXElement()) return null;
  return { listExprPath: callee.get('object'), itemParamName: callback.node.params[0].name, templatePath };
}

export function classifyStructuralExpr(exprPath) {
  return classifyConditionalExpr(exprPath) ?? classifyListExpr(exprPath);
}

// リストアイテムのテンプレートは意図的にコンパイラの renderElement を通さない:
// フィールドは追跡対象の宣言ではなくただのコールバック引数から来るので、
// 永続マーカーとして登録するものがない。リスト更新のたびにアイテム全体を
// 作り直す(src/compiler.js のヘッダーコメント参照)。
export function renderItemTemplate(templatePath, source) {
  const slice = (path) => source.slice(path.node.start, path.node.end);
  const tagName = templatePath.node.openingElement.name.name;
  let keyExprSrc = null;
  for (const attr of templatePath.get('openingElement.attributes')) {
    if (attr.node.name.name === 'key') keyExprSrc = slice(attr.get('value.expression'));
  }
  if (!keyExprSrc) throw new Error('compile: list items must have a key={...} attribute (scope limit)');

  let innerSrc = '';
  for (const child of templatePath.get('children')) {
    if (child.isJSXText()) innerSrc += escapeTemplateText(child.node.value);
    else if (child.isJSXExpressionContainer()) innerSrc += '${' + slice(child.get('expression')) + '}';
    else throw new Error(`compile: unsupported JSX child <${child.node.type}> in a list item template (scope limit)`);
  }
  return { tagName, keyExprSrc, innerSrc };
}
