// JSX ツリーを深さ優先で辿り、宣言・マーカー・ハンドラを ctx に積みながら
// フラットな HTML テンプレートソースを組み立てる(インライン化本体)。

import { escapeTemplateText, escapeAttrValue, innerTemplateSource, embedBranch } from '../template.js';
import { classifyConditionalExpr, classifyListExpr, classifyStructuralExpr, renderItemTemplate } from '../classify.js';
import { declKey, assignOutputName, nextMarkerId, nextInstanceId } from './state.js';
import { analyzeExpr, analyzeHandlerExpr, bareTrackedDeclId } from './analyze.js';

// declarator に declId を採番・登録し、plain / instrumented の
// `const <name> = <kind>(<arg>)` 出力ペアを emit する。
// signal/derived 宣言と prop 昇格の両方から使う。
function emitReactiveDecl(ctx, instanceId, declaratorStart, naturalName, kind, argSrc, out) {
  const declId = `decl_${instanceId}_${declaratorStart}`;
  ctx.declIdByKey.set(declKey(instanceId, declaratorStart), declId);
  ctx.declKind.set(declId, kind);
  const outputName = assignOutputName(ctx, naturalName, declId);
  out.declStatements.push(`const ${outputName} = ${kind}(${argSrc});`);
  out.instrumentedDeclStatements.push(`const ${outputName} = ${kind}(${argSrc}, ${JSON.stringify(declId)});`);
  return declId;
}

// ホスト要素の openingElement から `on[A-Z]...` 属性を集めてハンドラ解析
// する。構造ユニット(条件分岐ブランチ)内にあるハンドラはブランチが
// innerHTML 的に丸ごと差し替わり listener が失われるため、スコープ制限
// として明示的にエラーにする - アップグレード経路は
// docs/adr/0002-event-handlers.md 参照。
function collectHandlerAttrs(ctx, openingElementPath, instanceId, inStructural) {
  const result = [];
  for (const attr of openingElementPath.get('attributes')) {
    const name = attr.node.name.name;
    if (!/^on[A-Z]/.test(name)) continue;
    if (inStructural) {
      throw new Error(`compile: event handler "${name}" inside a conditional branch is not supported yet (scope limit)`);
    }
    const valueNode = attr.node.value;
    if (!valueNode || valueNode.type !== 'JSXExpressionContainer') {
      throw new Error(`compile: handler "${name}" must be an expression (scope limit)`);
    }
    const eventName = name.slice(2).toLowerCase();
    const { rendered, writeDeclIds } = analyzeHandlerExpr(ctx, attr.get('value.expression'), instanceId);
    result.push({ eventName, rendered, writeDeclIds });
  }
  return result;
}

// ホスト要素の openingElement からハンドラ以外の属性を集めて HTML
// 断片にする。値が JSXExpressionContainer な動的属性は新しい種類の
// マーカーが要る(plans/003 でスコープ外にした Attribute マーカー、
// CONCEPT.v2.md の Attribute#5 参照)ため、黙って握りつぶさずコンパイル
// エラーにする。
function collectStaticAttrs(openingElementPath) {
  let attrsSrc = '';
  for (const attr of openingElementPath.get('attributes')) {
    const name = attr.node.name.name;
    if (/^on[A-Z]/.test(name)) continue; // collectHandlerAttrs が別扱い
    const valueNode = attr.node.value;
    if (valueNode == null) {
      attrsSrc += ` ${name}`;
    } else if (valueNode.type === 'StringLiteral') {
      attrsSrc += ` ${name}="${escapeAttrValue(valueNode.value)}"`;
    } else if (valueNode.type === 'JSXExpressionContainer') {
      throw new Error(`compile: dynamic attribute "${name}" on a host element is not supported yet (scope limit)`);
    } else {
      throw new Error(`compile: unsupported attribute value for "${name}" (scope limit)`);
    }
  }
  return attrsSrc;
}

// handlerAttrs を ctx.handlers に確定登録する。markerId は呼び出し側が
// (既存のテキストマーカー流用 or 新規採番のどちらかで)決めて渡す。
function registerHandlers(ctx, markerId, handlerAttrs) {
  for (const h of handlerAttrs) {
    ctx.handlers.push({ markerId, eventName: h.eventName, rendered: h.rendered, writeDeclIds: h.writeDeclIds });
  }
}

function buildPropBindings(ctx, openingElementPath, instanceId) {
  const bindings = new Map();
  for (const attr of openingElementPath.get('attributes')) {
    const name = attr.node.name.name;
    const valueNode = attr.node.value;
    if (valueNode.type === 'StringLiteral') {
      bindings.set(name, { mode: 'literal', rendered: JSON.stringify(valueNode.value) });
    } else if (valueNode.type === 'JSXExpressionContainer') {
      const exprPath = attr.get('value.expression');
      const aliasDeclId = bareTrackedDeclId(ctx, exprPath, instanceId);
      if (aliasDeclId) {
        bindings.set(name, { mode: 'alias', declId: aliasDeclId });
      } else {
        bindings.set(name, { mode: 'literal', rendered: analyzeExpr(ctx, exprPath, instanceId).rendered });
      }
    } else {
      throw new Error(`compile: unsupported prop value for "${name}" (scope limit)`);
    }
  }
  return bindings;
}

function processDeclarationStatement(ctx, stmt, propBindings, instanceId, out) {
  if (stmt.isVariableDeclaration() && stmt.node.declarations.length === 1) {
    const declarator = stmt.node.declarations[0];
    const init = declarator.init;
    if (init && init.type === 'CallExpression' && init.callee.type === 'Identifier') {
      const kind = init.callee.name;

      if (kind === 'signal' || kind === 'derived') {
        const argPath = stmt.get('declarations.0.init.arguments.0');
        const { deps, rendered } = analyzeExpr(ctx, argPath, instanceId);
        const declId = emitReactiveDecl(ctx, instanceId, declarator.start, declarator.id.name, kind, rendered, out);
        if (kind === 'derived') ctx.derivedDeps.set(declId, deps);
        return;
      }

      if (kind === 'prop') {
        const propName = init.arguments[0].value;
        const binding = propBindings.get(propName);
        if (!binding) throw new Error(`compile: no value passed for prop "${propName}"`);

        if (binding.mode === 'alias') {
          ctx.declIdByKey.set(declKey(instanceId, declarator.start), binding.declId);
          // 既存 signal と同じ declId - 新しいストレージも宣言も不要。
          // 以降の参照はすべてそこへ直接解決される。
        } else {
          emitReactiveDecl(ctx, instanceId, declarator.start, declarator.id.name, 'signal', binding.rendered, out);
        }
        return;
      }
    }
  }
  // 非リアクティブなローカル(例 `const step = 2;`)- そのまま残し、
  // hygienic リネームはしない(上記スコープ制限参照)。
  out.declStatements.push(ctx.sliceSrc(stmt));
  out.instrumentedDeclStatements.push(ctx.sliceSrc(stmt));
}

// ブランチが描画するのは JSX 要素か、無(null リテラルまたは `false`)。
// ブランチの中身は常に構造ユニット配下(inStructural=true)として扱う -
// スワップのたびに丸ごと作り直されるため。
function renderBranch(ctx, branchPath, componentsByName, instanceId, out) {
  if (!branchPath) return null;
  if (branchPath.isJSXElement()) return renderElement(ctx, branchPath, componentsByName, instanceId, out, true);
  if (branchPath.isNullLiteral() || branchPath.isBooleanLiteral({ value: false })) return null;
  throw new Error('compile: conditional branches must be a JSX element, null, or false (scope limit)');
}

function renderConditional(ctx, exprPath, componentsByName, instanceId, out) {
  const cls = classifyConditionalExpr(exprPath);
  const { deps, rendered: conditionCode } = analyzeExpr(ctx, cls.conditionPath, instanceId);
  const markerId = nextMarkerId(ctx);
  const truthyHtml = renderBranch(ctx, cls.truthyPath, componentsByName, instanceId, out);
  const falsyHtml = renderBranch(ctx, cls.falsyPath, componentsByName, instanceId, out);

  ctx.markers.push({ id: markerId, kind: 'conditional', conditionCode, truthyHtml, falsyHtml });
  ctx.markerDeps.set(markerId, deps);

  return `<!--${markerId}-->\${${conditionCode} ? ${embedBranch(truthyHtml)} : ${embedBranch(falsyHtml)}}`;
}

function renderList(ctx, exprPath, instanceId) {
  const cls = classifyListExpr(exprPath);
  const { deps, rendered: listCode } = analyzeExpr(ctx, cls.listExprPath, instanceId);
  // renderItemTemplate は key 以外の属性を黙って無視するので、ハンドラを
  // 静かに握りつぶさないようここで明示的に弾く。リストアイテムは
  // innerHTML で丸ごと作り直されるため listener を保持できない
  // (アップグレード経路は docs/adr/0002-event-handlers.md 参照)。
  for (const attr of cls.templatePath.get('openingElement.attributes')) {
    const attrName = attr.node.name.name;
    if (/^on[A-Z]/.test(attrName)) {
      throw new Error(`compile: event handler "${attrName}" inside a list item template is not supported yet (scope limit)`);
    }
  }
  const { tagName, keyExprSrc, innerSrc } = renderItemTemplate(cls.templatePath, ctx.source);
  const markerId = nextMarkerId(ctx);

  ctx.markers.push({ id: markerId, kind: 'list', listCode, itemParamName: cls.itemParamName, tagName, keyExprSrc, innerSrc });
  ctx.markerDeps.set(markerId, deps);

  const itemHtml = `<${tagName}>${innerSrc}</${tagName}>`;
  return `<!--${markerId}_start-->\${${listCode}.map((${cls.itemParamName}) => \`${itemHtml}\`).join('')}<!--${markerId}_end-->`;
}

// JSXText/式の子の連なりを、1回の textContent 置換で更新するアトミックな
// ユニットとして扱う:マーカーを登録し、内側のテンプレートソースを返す。
// renderChildren の run と要素まるごとマーカーの両方から使う。
function buildTextMarker(ctx, runPaths, instanceId) {
  const markerId = nextMarkerId(ctx);
  const contentParts = [];
  const deps = new Set();
  for (const p of runPaths) {
    if (p.isJSXText()) {
      contentParts.push({ type: 'text', value: p.node.value });
    } else if (p.isJSXExpressionContainer()) {
      const { deps: exprDeps, rendered } = analyzeExpr(ctx, p.get('expression'), instanceId);
      contentParts.push({ type: 'expr', code: rendered });
      for (const d of exprDeps) deps.add(d);
    } else {
      throw new Error('compile: mixing elements into a reactive text unit is not supported yet (scope limit)');
    }
  }
  ctx.markers.push({ id: markerId, kind: 'text', contentParts });
  ctx.markerDeps.set(markerId, deps);
  return { markerId, inner: innerTemplateSource(contentParts) };
}

// 直接の子に条件分岐/リストを1つ以上含むホスト要素の子の処理:内容の
// 一部が構造ユニットになるため、単純なテキストマーカーの場合と違い、
// 要素自体を1回の textContent 置換ユニットにはできない。静的テキスト/
// 単純式の連なりは引き続きまとめて自前のテキストマーカーになるが、
// 自分を包む要素を持たない裸の連なりには、クエリ可能な足場として
// 合成の <span> を付ける。
function renderChildren(ctx, childrenPaths, componentsByName, instanceId, out, inStructural) {
  let result = '';
  let run = [];
  const flushRun = () => {
    if (run.length === 0) return;
    const hasExpr = run.some((p) => p.isJSXExpressionContainer());
    if (!hasExpr) {
      for (const p of run) result += escapeTemplateText(p.node.value);
    } else {
      const { markerId, inner } = buildTextMarker(ctx, run, instanceId);
      result += `<span data-iris-id="${markerId}">${inner}</span>`;
    }
    run = [];
  };

  for (const child of childrenPaths) {
    if (child.isJSXExpressionContainer() && classifyConditionalExpr(child.get('expression'))) {
      flushRun();
      result += renderConditional(ctx, child.get('expression'), componentsByName, instanceId, out);
    } else if (child.isJSXExpressionContainer() && classifyListExpr(child.get('expression'))) {
      flushRun();
      result += renderList(ctx, child.get('expression'), instanceId);
    } else if (child.isJSXText() || child.isJSXExpressionContainer()) {
      run.push(child);
    } else if (child.isJSXElement()) {
      flushRun();
      result += renderElement(ctx, child, componentsByName, instanceId, out, inStructural);
    } else {
      throw new Error(`compile: unsupported JSX child <${child.node.type}> (scope limit)`);
    }
  }
  flushRun();
  return result;
}

function renderElement(ctx, elementPath, componentsByName, instanceId, out, inStructural) {
  const tagName = elementPath.node.openingElement.name.name;

  if (/^[A-Z]/.test(tagName)) {
    const childPath = componentsByName.get(tagName);
    if (!childPath) throw new Error(`compile: unknown component <${tagName}>`);
    const propBindings = buildPropBindings(ctx, elementPath.get('openingElement'), instanceId);
    const childInstanceId = nextInstanceId(ctx);
    return compileComponent(ctx, childPath, propBindings, childInstanceId, componentsByName, out, inStructural);
  }

  const handlerAttrs = collectHandlerAttrs(ctx, elementPath.get('openingElement'), instanceId, inStructural);
  const attrsSrc = collectStaticAttrs(elementPath.get('openingElement'));

  const children = elementPath.get('children');
  const hasStructural = children.some((c) => c.isJSXExpressionContainer() && classifyStructuralExpr(c.get('expression')));
  if (hasStructural) {
    const inner = renderChildren(ctx, children, componentsByName, instanceId, out, inStructural);
    if (handlerAttrs.length === 0) return `<${tagName}${attrsSrc}>${inner}</${tagName}>`;
    const markerId = nextMarkerId(ctx);
    registerHandlers(ctx, markerId, handlerAttrs);
    return `<${tagName}${attrsSrc} data-iris-id="${markerId}">${inner}</${tagName}>`;
  }

  const hasDirectExpr = children.some((c) => c.isJSXExpressionContainer());

  if (!hasDirectExpr) {
    let inner = '';
    for (const child of children) {
      if (child.isJSXText()) inner += escapeTemplateText(child.node.value);
      else if (child.isJSXElement()) inner += renderElement(ctx, child, componentsByName, instanceId, out, inStructural);
      else throw new Error(`compile: unsupported JSX child <${child.node.type}> (scope limit)`);
    }
    if (handlerAttrs.length === 0) return `<${tagName}${attrsSrc}>${inner}</${tagName}>`;
    const markerId = nextMarkerId(ctx);
    registerHandlers(ctx, markerId, handlerAttrs);
    return `<${tagName}${attrsSrc} data-iris-id="${markerId}">${inner}</${tagName}>`;
  }

  const { markerId, inner } = buildTextMarker(ctx, children, instanceId);
  if (handlerAttrs.length > 0) registerHandlers(ctx, markerId, handlerAttrs);
  return `<${tagName}${attrsSrc} data-iris-id="${markerId}">${inner}</${tagName}>`;
}

export function compileComponent(ctx, componentPath, propBindings, instanceId, componentsByName, out, inStructural) {
  let returnArgPath = null;
  for (const stmt of componentPath.get('body.body')) {
    if (stmt.isReturnStatement()) {
      returnArgPath = stmt.get('argument');
      continue;
    }
    processDeclarationStatement(ctx, stmt, propBindings, instanceId, out);
  }
  if (!returnArgPath || !returnArgPath.isJSXElement()) {
    throw new Error('compile: component must return a single JSX element (scope limit)');
  }
  return renderElement(ctx, returnArgPath, componentsByName, instanceId, out, inStructural);
}
