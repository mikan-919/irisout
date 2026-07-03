// Milestone 1-5 compiler: expression dependency analysis, props propagation,
// component boundary inlining, and structural updates - conditionals and
// keyed lists (docs/adr/0001-first-milestone.md).
//
// Pipeline:
//   1. Parse source with @babel/parser (static AST).
//   2. Find every top-level component function; the root is whichever one is
//      never referenced as a JSX tag by another (scope: exactly one root).
//   3. Walk the root's render tree depth-first. A `<Child prop={expr} />`
//      reference is compiled recursively into the same flat declaration and
//      marker lists - this *is* the inlining: by the time codegen runs there
//      is no trace of the original component boundary left, only one shared
//      scope. Each instantiation site gets its own instanceId, so the same
//      component used twice (`<Row n={1}/><Row n={2}/>`) gets two completely
//      independent signals instead of colliding on the same declaration's
//      source position.
//        - if a prop's value is a bare read of an already-tracked
//          signal/derived (e.g. `count()`, no extra computation), the
//          child's `prop('x')` is aliased to that SAME declId. There is no
//          separate storage, so a write from either side is visible from
//          both - "props propagation" (and write-back) falls out for free.
//        - otherwise (a literal, or any computed expression) the child's
//          `prop('x')` is promoted to its own independent `signal(expr)`.
//   4. Because instances share one flattened output scope, identifiers can
//      collide (two instances both declaring `n`). Every signal/derived/
//      promoted-prop gets a hygienic output name (`n`, then `n$1`, ...), and
//      every expression that reads it gets that reference rewritten to the
//      output name wherever it's used - across component boundaries too.
//   5. Execute the flattened, instrumented script on Node once to (a)
//      confirm every tagged call site really is a signal/derived (ADR
//      decision #3), and (b) obtain the real initial HTML for free.
//   6. Build the dependency graph (marker -> signal, through derived, across
//      instances) and generate one dedicated `update_<name>` function per
//      root signal, touching every marker that depends on it.
//
// Conditional rendering (`cond && <A/>` or `cond ? <A/> : <B/>`) is a
// different KIND of marker: a "structural" unit. It can't be done with a
// textContent swap since the branches are real markup, so it gets an
// always-present comment anchor (`<!--m2-->`) instead of an attribute on an
// element - a comment survives even when nothing is currently rendered.
// Whichever branch renders nothing (null/false, or simply not the active
// side) is baked as an empty `<!---->` placeholder, so there's always
// exactly one sibling right after the anchor to tear down before mounting
// the other branch. A branch's own reactive markers/anchors are discovered
// generically at runtime (see runtime.js's collectReactive/forgetReactive)
// rather than tracked at compile time, so arbitrarily nested reactive
// content or further conditionals inside a branch fall out for free.
//
// Keyed lists (`items().map(item => <li key={item.id}>{item.name}</li>)`)
// are a third kind of marker, also anchored by comments - but a *range*
// (`<!--m3_start-->`...`<!--m3_end-->`) since the number of items varies.
// Reconciliation on update is deliberately naive: walk the new array in
// order, reuse the existing element for a key that already has one
// (refreshing its content since the item's own fields aren't tracked
// signals - the whole item is just re-rendered), create one for a new key,
// and `insertBefore(el, end)` every one of them in the new order - repeated
// insertBefore calls double as the reordering step, since inserting a node
// that already exists elsewhere in the document *moves* it. This is not
// move-count-optimal (no LIS-based minimal-move diff); that's a deliberate
// deferral, not an oversight - see docs/adr/0001-first-milestone.md.
//
// Scope limits (documented, not hidden): single file (no cross-module
// imports of components), one static instance per non-list JSX reference,
// list item templates are text/expr-only (no nested elements, conditionals,
// or further lists, and no access to signals outside the item's own
// fields), and hygienic renaming only covers signal/derived/prop
// declarations - a plain non-reactive local (`const step = 2`) is kept
// verbatim and can still collide across instances.

import { parse } from '@babel/parser';
import traverseImport from '@babel/traverse';
import { signal, derived, registry } from './runtime.js';

const traverse = traverseImport.default ?? traverseImport;

function escapeTemplateText(text) {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

// contentParts -> the *inner* source text of a template literal (no backticks).
function innerTemplateSource(contentParts) {
  return contentParts
    .map((part) => (part.type === 'text' ? escapeTemplateText(part.value) : '${' + part.code + '}'))
    .join('');
}

export function compile(source) {
  registry.clear();

  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const sliceSrc = (path) => source.slice(path.node.start, path.node.end);

  // key: `${instanceId}:${declaratorStart}` -> declId. Composite because the
  // same declarator node is revisited once per instance of its component.
  const declIdByKey = new Map();
  const declKind = new Map(); // declId -> 'signal' | 'derived'
  const declOutputName = new Map(); // declId -> hygienic output identifier
  const derivedDeps = new Map(); // declId -> Set<declId>
  const usedOutputNames = new Set();
  const markers = []; // { id, contentParts }
  const markerDeps = new Map(); // markerId -> Set<declId> (direct, pre-transitive-closure)
  let markerCounter = 0;
  let instanceCounter = 0;

  const declKey = (instanceId, start) => `${instanceId}:${start}`;

  function assignOutputName(naturalName, declId) {
    let candidate = naturalName;
    let n = 1;
    while (usedOutputNames.has(candidate)) candidate = `${naturalName}$${n++}`;
    usedOutputNames.add(candidate);
    declOutputName.set(declId, candidate);
    return candidate;
  }

  // Walks an expression, resolving every referenced identifier back to a
  // tracked declId (if any) via lexical scope, and returns both the set of
  // deps and the source text with those references rewritten to their
  // hygienic output names (a no-op if nothing needed renaming).
  function analyzeExpr(path, instanceId) {
    const deps = new Set();
    const edits = [];
    const visit = (idPath) => {
      const binding = idPath.scope.getBinding(idPath.node.name);
      if (!binding || binding.path.node.type !== 'VariableDeclarator') return;
      const declId = declIdByKey.get(declKey(instanceId, binding.path.node.start));
      if (!declId) return;
      deps.add(declId);
      const outputName = declOutputName.get(declId);
      if (outputName && outputName !== idPath.node.name) {
        edits.push({ start: idPath.node.start, end: idPath.node.end, text: outputName });
      }
    };
    if (path.isIdentifier()) visit(path);
    path.traverse({
      Identifier(idPath) {
        if (idPath.isReferencedIdentifier()) visit(idPath);
      },
    });
    edits.sort((a, b) => a.start - b.start);
    let rendered = '';
    let cursor = path.node.start;
    for (const edit of edits) {
      rendered += source.slice(cursor, edit.start) + edit.text;
      cursor = edit.end;
    }
    rendered += source.slice(cursor, path.node.end);
    return { deps, rendered };
  }

  // A bare read like `count()` - a zero-arg call of an already-tracked
  // signal/derived, with no surrounding computation - can be safely aliased.
  // Anything else (a literal, `count() + 1`, ...) can't be written back to
  // in general, so it's promoted to an independent signal instead.
  function bareTrackedDeclId(exprPath, instanceId) {
    if (!exprPath.isCallExpression() || exprPath.node.arguments.length !== 0) return null;
    const callee = exprPath.get('callee');
    if (!callee.isIdentifier()) return null;
    const binding = callee.scope.getBinding(callee.node.name);
    if (!binding || binding.path.node.type !== 'VariableDeclarator') return null;
    return declIdByKey.get(declKey(instanceId, binding.path.node.start)) ?? null;
  }

  function buildPropBindings(openingElementPath, instanceId) {
    const bindings = new Map();
    for (const attr of openingElementPath.get('attributes')) {
      const name = attr.node.name.name;
      const valueNode = attr.node.value;
      if (valueNode.type === 'StringLiteral') {
        bindings.set(name, { mode: 'literal', rendered: JSON.stringify(valueNode.value) });
      } else if (valueNode.type === 'JSXExpressionContainer') {
        const exprPath = attr.get('value.expression');
        const aliasDeclId = bareTrackedDeclId(exprPath, instanceId);
        if (aliasDeclId) {
          bindings.set(name, { mode: 'alias', declId: aliasDeclId });
        } else {
          bindings.set(name, { mode: 'literal', rendered: analyzeExpr(exprPath, instanceId).rendered });
        }
      } else {
        throw new Error(`compile: unsupported prop value for "${name}" (scope limit)`);
      }
    }
    return bindings;
  }

  function processDeclarationStatement(stmt, propBindings, instanceId, out) {
    if (stmt.isVariableDeclaration() && stmt.node.declarations.length === 1) {
      const declarator = stmt.node.declarations[0];
      const init = declarator.init;
      if (init && init.type === 'CallExpression' && init.callee.type === 'Identifier') {
        const kind = init.callee.name;

        if (kind === 'signal' || kind === 'derived') {
          const declId = `decl_${instanceId}_${declarator.start}`;
          declIdByKey.set(declKey(instanceId, declarator.start), declId);
          declKind.set(declId, kind);
          const outputName = assignOutputName(declarator.id.name, declId);
          const argPath = stmt.get('declarations.0.init.arguments.0');
          const { deps, rendered } = analyzeExpr(argPath, instanceId);
          if (kind === 'derived') derivedDeps.set(declId, deps);
          out.declStatements.push(`const ${outputName} = ${kind}(${rendered});`);
          out.instrumentedDeclStatements.push(`const ${outputName} = ${kind}(${rendered}, ${JSON.stringify(declId)});`);
          return;
        }

        if (kind === 'prop') {
          const propName = init.arguments[0].value;
          const binding = propBindings.get(propName);
          if (!binding) throw new Error(`compile: no value passed for prop "${propName}"`);

          if (binding.mode === 'alias') {
            declIdByKey.set(declKey(instanceId, declarator.start), binding.declId);
            // Same declId as an existing signal - no new storage, nothing to
            // declare. Every reference below resolves straight to it.
          } else {
            const declId = `decl_${instanceId}_${declarator.start}`;
            declIdByKey.set(declKey(instanceId, declarator.start), declId);
            declKind.set(declId, 'signal');
            const outputName = assignOutputName(declarator.id.name, declId);
            out.declStatements.push(`const ${outputName} = signal(${binding.rendered});`);
            out.instrumentedDeclStatements.push(`const ${outputName} = signal(${binding.rendered}, ${JSON.stringify(declId)});`);
          }
          return;
        }
      }
    }
    // Plain non-reactive local (e.g. `const step = 2;`) - kept verbatim, not
    // hygienically renamed (see scope limits above).
    out.declStatements.push(sliceSrc(stmt));
    out.instrumentedDeclStatements.push(sliceSrc(stmt));
  }

  // `cond && <A/>` (no falsy branch - renders nothing) or `cond ? <A/> : <B/>`.
  function classifyConditionalExpr(exprPath) {
    if (exprPath.isLogicalExpression({ operator: '&&' })) {
      return { conditionPath: exprPath.get('left'), truthyPath: exprPath.get('right'), falsyPath: null };
    }
    if (exprPath.isConditionalExpression()) {
      return { conditionPath: exprPath.get('test'), truthyPath: exprPath.get('consequent'), falsyPath: exprPath.get('alternate') };
    }
    return null;
  }

  // A branch renders either a JSX element, or nothing (null literal or `false`).
  function renderBranch(branchPath, componentsByName, instanceId, out) {
    if (!branchPath) return null;
    if (branchPath.isJSXElement()) return renderElement(branchPath, componentsByName, instanceId, out);
    if (branchPath.isNullLiteral() || branchPath.isBooleanLiteral({ value: false })) return null;
    throw new Error('compile: conditional branches must be a JSX element, null, or false (scope limit)');
  }

  function renderConditional(exprPath, componentsByName, instanceId, out) {
    const cls = classifyConditionalExpr(exprPath);
    const { deps, rendered: conditionCode } = analyzeExpr(cls.conditionPath, instanceId);
    const markerId = `m${markerCounter++}`;
    const truthyHtml = renderBranch(cls.truthyPath, componentsByName, instanceId, out);
    const falsyHtml = renderBranch(cls.falsyPath, componentsByName, instanceId, out);

    markers.push({ id: markerId, kind: 'conditional', conditionCode, truthyHtml, falsyHtml });
    markerDeps.set(markerId, deps);

    const truthyEmbed = truthyHtml !== null ? `\`${truthyHtml}\`` : '`<!---->`';
    const falsyEmbed = falsyHtml !== null ? `\`${falsyHtml}\`` : '`<!---->`';
    return `<!--${markerId}-->\${${conditionCode} ? ${truthyEmbed} : ${falsyEmbed}}`;
  }

  // `things().map(item => <li key={item.id}>...</li>)`, concise or block body.
  function classifyListExpr(exprPath) {
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

  // A list item template is intentionally not run through renderElement: its
  // fields come from a plain callback parameter, not a tracked declaration,
  // so there is nothing to register as a persistent marker - the whole item
  // is regenerated from scratch on every list update (see header comment).
  function renderItemTemplate(templatePath) {
    const tagName = templatePath.node.openingElement.name.name;
    let keyExprSrc = null;
    for (const attr of templatePath.get('openingElement.attributes')) {
      if (attr.node.name.name === 'key') keyExprSrc = sliceSrc(attr.get('value.expression'));
    }
    if (!keyExprSrc) throw new Error('compile: list items must have a key={...} attribute (scope limit)');

    let innerSrc = '';
    for (const child of templatePath.get('children')) {
      if (child.isJSXText()) innerSrc += escapeTemplateText(child.node.value);
      else if (child.isJSXExpressionContainer()) innerSrc += '${' + sliceSrc(child.get('expression')) + '}';
      else throw new Error(`compile: unsupported JSX child <${child.node.type}> in a list item template (scope limit)`);
    }
    return { tagName, keyExprSrc, innerSrc };
  }

  function renderList(exprPath, instanceId) {
    const cls = classifyListExpr(exprPath);
    const { deps, rendered: listCode } = analyzeExpr(cls.listExprPath, instanceId);
    const { tagName, keyExprSrc, innerSrc } = renderItemTemplate(cls.templatePath);
    const markerId = `m${markerCounter++}`;

    markers.push({ id: markerId, kind: 'list', listCode, itemParamName: cls.itemParamName, tagName, keyExprSrc, innerSrc });
    markerDeps.set(markerId, deps);

    const itemHtml = `<${tagName}>${innerSrc}</${tagName}>`;
    return `<!--${markerId}_start-->\${${listCode}.map((${cls.itemParamName}) => \`${itemHtml}\`).join('')}<!--${markerId}_end-->`;
  }

  function classifyStructuralExpr(exprPath) {
    return classifyConditionalExpr(exprPath) ?? classifyListExpr(exprPath);
  }

  // Children of a host element that has at least one conditional/list among
  // its direct children: unlike the plain text-marker case, the element
  // itself can no longer be one atomic textContent-replace unit, since part
  // of its content is now structural. Static text/plain-expr runs still get
  // grouped into their own text marker; a bare run with no wrapping element
  // of its own is tagged with a synthetic <span> so it has something queryable.
  function renderChildren(childrenPaths, componentsByName, instanceId, out) {
    let result = '';
    let run = [];
    const flushRun = () => {
      if (run.length === 0) return;
      const hasExpr = run.some((p) => p.isJSXExpressionContainer());
      if (!hasExpr) {
        for (const p of run) result += escapeTemplateText(p.node.value);
      } else {
        const markerId = `m${markerCounter++}`;
        const contentParts = [];
        const deps = new Set();
        for (const p of run) {
          if (p.isJSXText()) {
            contentParts.push({ type: 'text', value: p.node.value });
          } else {
            const exprPath = p.get('expression');
            const { deps: exprDeps, rendered } = analyzeExpr(exprPath, instanceId);
            contentParts.push({ type: 'expr', code: rendered });
            for (const d of exprDeps) deps.add(d);
          }
        }
        markers.push({ id: markerId, kind: 'text', contentParts });
        markerDeps.set(markerId, deps);
        result += `<span data-iris-id="${markerId}">${innerTemplateSource(contentParts)}</span>`;
      }
      run = [];
    };

    for (const child of childrenPaths) {
      if (child.isJSXExpressionContainer() && classifyConditionalExpr(child.get('expression'))) {
        flushRun();
        result += renderConditional(child.get('expression'), componentsByName, instanceId, out);
      } else if (child.isJSXExpressionContainer() && classifyListExpr(child.get('expression'))) {
        flushRun();
        result += renderList(child.get('expression'), instanceId);
      } else if (child.isJSXText() || child.isJSXExpressionContainer()) {
        run.push(child);
      } else if (child.isJSXElement()) {
        flushRun();
        result += renderElement(child, componentsByName, instanceId, out);
      } else {
        throw new Error(`compile: unsupported JSX child <${child.node.type}> (scope limit)`);
      }
    }
    flushRun();
    return result;
  }

  function renderElement(elementPath, componentsByName, instanceId, out) {
    const tagName = elementPath.node.openingElement.name.name;

    if (/^[A-Z]/.test(tagName)) {
      const childPath = componentsByName.get(tagName);
      if (!childPath) throw new Error(`compile: unknown component <${tagName}>`);
      const propBindings = buildPropBindings(elementPath.get('openingElement'), instanceId);
      const childInstanceId = instanceCounter++;
      return compileComponent(childPath, propBindings, childInstanceId, componentsByName, out);
    }

    const children = elementPath.get('children');
    const hasStructural = children.some((c) => c.isJSXExpressionContainer() && classifyStructuralExpr(c.get('expression')));
    if (hasStructural) {
      const inner = renderChildren(children, componentsByName, instanceId, out);
      return `<${tagName}>${inner}</${tagName}>`;
    }

    const hasDirectExpr = children.some((c) => c.isJSXExpressionContainer());

    if (!hasDirectExpr) {
      let inner = '';
      for (const child of children) {
        if (child.isJSXText()) inner += escapeTemplateText(child.node.value);
        else if (child.isJSXElement()) inner += renderElement(child, componentsByName, instanceId, out);
        else throw new Error(`compile: unsupported JSX child <${child.node.type}> (scope limit)`);
      }
      return `<${tagName}>${inner}</${tagName}>`;
    }

    const markerId = `m${markerCounter++}`;
    const contentParts = [];
    const deps = new Set();
    for (const child of children) {
      if (child.isJSXText()) {
        contentParts.push({ type: 'text', value: child.node.value });
      } else if (child.isJSXExpressionContainer()) {
        const exprPath = child.get('expression');
        const { deps: exprDeps, rendered } = analyzeExpr(exprPath, instanceId);
        contentParts.push({ type: 'expr', code: rendered });
        for (const d of exprDeps) deps.add(d);
      } else {
        throw new Error('compile: mixing elements into a reactive text unit is not supported yet (scope limit)');
      }
    }
    markers.push({ id: markerId, kind: 'text', contentParts });
    markerDeps.set(markerId, deps);
    return `<${tagName} data-iris-id="${markerId}">${innerTemplateSource(contentParts)}</${tagName}>`;
  }

  function compileComponent(componentPath, propBindings, instanceId, componentsByName, out) {
    let returnArgPath = null;
    for (const stmt of componentPath.get('body.body')) {
      if (stmt.isReturnStatement()) {
        returnArgPath = stmt.get('argument');
        continue;
      }
      processDeclarationStatement(stmt, propBindings, instanceId, out);
    }
    if (!returnArgPath || !returnArgPath.isJSXElement()) {
      throw new Error('compile: component must return a single JSX element (scope limit)');
    }
    return renderElement(returnArgPath, componentsByName, instanceId, out);
  }

  // --- find every top-level component, and the one root no one else references ---
  const componentsByName = new Map();
  traverse(ast, {
    FunctionDeclaration(path) {
      if (path.parentPath.isProgram() || path.parentPath.isExportNamedDeclaration()) {
        componentsByName.set(path.node.id.name, path);
      }
    },
  });
  if (componentsByName.size === 0) throw new Error('compile: no component function found');

  const referenced = new Set();
  for (const path of componentsByName.values()) {
    path.traverse({
      JSXOpeningElement(jsxPath) {
        const name = jsxPath.node.name.name;
        if (/^[A-Z]/.test(name) && componentsByName.has(name)) referenced.add(name);
      },
    });
  }
  const rootNames = [...componentsByName.keys()].filter((name) => !referenced.has(name));
  if (rootNames.length !== 1) {
    throw new Error(`compile: expected exactly one root component, found [${rootNames.join(', ')}] (scope limit)`);
  }
  const rootPath = componentsByName.get(rootNames[0]);

  const out = { declStatements: [], instrumentedDeclStatements: [] };
  const rootHtmlSource = compileComponent(rootPath, new Map(), instanceCounter++, componentsByName, out);

  // --- transitive closure: expand derived declIds up to their root signals ---
  function resolveToSignals(declId, visited) {
    if (visited.has(declId)) return new Set();
    visited.add(declId);
    if (declKind.get(declId) === 'signal') return new Set([declId]);
    const result = new Set();
    for (const upstream of derivedDeps.get(declId) ?? []) {
      for (const sig of resolveToSignals(upstream, visited)) result.add(sig);
    }
    return result;
  }

  const signalToMarkers = new Map(); // declId -> Set<markerId>
  for (const [markerId, deps] of markerDeps) {
    for (const dep of deps) {
      for (const sig of resolveToSignals(dep, new Set())) {
        if (!signalToMarkers.has(sig)) signalToMarkers.set(sig, new Set());
        signalToMarkers.get(sig).add(markerId);
      }
    }
  }

  // --- build-time execution: confirm discovery + obtain the real initial HTML ---
  const instrumentedBody = [...out.instrumentedDeclStatements, `return \`${rootHtmlSource}\`;`].join('\n');
  const runComponent = new Function('signal', 'derived', instrumentedBody);
  const initialHtml = runComponent(signal, derived);

  for (const [declId, kind] of declKind) {
    const entry = registry.get(declId);
    if (!entry || entry.kind !== kind) {
      throw new Error(`compile: expected "${declOutputName.get(declId)}" to be a ${kind}() call (ADR-0001 #3 discovery check)`);
    }
  }

  // --- codegen: dedicated update_<name>() per root signal, across component/instance boundaries ---
  const conditionalMarkers = markers.filter((m) => m.kind === 'conditional');
  const listMarkers = markers.filter((m) => m.kind === 'list');

  const outLines = [];
  outLines.push("import { signal, derived, mount, collectReactive, forgetReactive, insertAfter, htmlToNode } from '../src/runtime.js';", '');
  outLines.push(...out.declStatements.map((s) => `export ${s}`), '');
  for (const m of listMarkers) {
    outLines.push(
      `const __itemInner_${m.id} = (${m.itemParamName}) => \`${m.innerSrc}\`;`,
      `const __itemHtml_${m.id} = (${m.itemParamName}) => \`<${m.tagName}>\${__itemInner_${m.id}(${m.itemParamName})}</${m.tagName}>\`;`,
      `const __itemKey_${m.id} = (${m.itemParamName}) => String(${m.keyExprSrc});`
    );
  }
  outLines.push('');
  outLines.push(`const __INITIAL_HTML__ = ${JSON.stringify(initialHtml)};`, '');
  outLines.push(
    `let __markers__, __anchors__${conditionalMarkers.map((m) => `, __cond_${m.id}`).join('')}${listMarkers.map((m) => `, __list_${m.id}`).join('')};`,
    'export function mountComponent(container) {',
    '  ({ markers: __markers__, anchors: __anchors__ } = mount(container, __INITIAL_HTML__));',
    ...conditionalMarkers.map((m) => `  __cond_${m.id} = ${m.conditionCode};`),
    ...listMarkers.flatMap((m) => [
      `  __list_${m.id} = new Map();`,
      `  { let __node = __anchors__.get(${JSON.stringify(m.id + '_start')}).nextSibling; for (const ${m.itemParamName} of ${m.listCode}) { __list_${m.id}.set(__itemKey_${m.id}(${m.itemParamName}), __node); __node = __node.nextSibling; } }`,
    ]),
    '}',
    ''
  );

  for (const [signalId, markerIds] of signalToMarkers) {
    const name = declOutputName.get(signalId);
    outLines.push(`export function update_${name}() {`);
    for (const mId of markerIds) {
      const marker = markers.find((m) => m.id === mId);
      if (marker.kind === 'conditional') {
        const truthyEmbed = marker.truthyHtml !== null ? `\`${marker.truthyHtml}\`` : '`<!---->`';
        const falsyEmbed = marker.falsyHtml !== null ? `\`${marker.falsyHtml}\`` : '`<!---->`';
        outLines.push(
          '  {',
          `    const __next = ${marker.conditionCode};`,
          `    if (__next !== __cond_${marker.id}) {`,
          `      const __anchor = __anchors__.get(${JSON.stringify(marker.id)});`,
          '      forgetReactive(__anchor.nextSibling, __markers__, __anchors__);',
          '      __anchor.nextSibling.remove();',
          `      insertAfter(__anchor, __next ? ${truthyEmbed} : ${falsyEmbed});`,
          '      collectReactive(__anchor.nextSibling, __markers__, __anchors__);',
          `      __cond_${marker.id} = __next;`,
          '    }',
          '  }'
        );
      } else if (marker.kind === 'list') {
        outLines.push(
          '  {',
          `    const __start = __anchors__.get(${JSON.stringify(marker.id + '_start')});`,
          `    const __end = __anchors__.get(${JSON.stringify(marker.id + '_end')});`,
          `    const __old = __list_${marker.id};`,
          '    const __next = new Map();',
          `    for (const ${marker.itemParamName} of ${marker.listCode}) {`,
          `      const __key = __itemKey_${marker.id}(${marker.itemParamName});`,
          '      let __el = __old.get(__key);',
          '      if (__el) {',
          `        __el.innerHTML = __itemInner_${marker.id}(${marker.itemParamName});`,
          '      } else {',
          `        __el = htmlToNode(__itemHtml_${marker.id}(${marker.itemParamName}), __start.ownerDocument);`,
          '      }',
          '      __end.parentNode.insertBefore(__el, __end);',
          '      __next.set(__key, __el);',
          '      __old.delete(__key);',
          '    }',
          '    for (const __el of __old.values()) __el.remove();',
          `    __list_${marker.id} = __next;`,
          '  }'
        );
      } else {
        outLines.push(`  { const __el = __markers__.get(${JSON.stringify(mId)}); if (__el) __el.textContent = \`${innerTemplateSource(marker.contentParts)}\`; }`);
      }
    }
    outLines.push('}', '');
  }

  return { code: outLines.join('\n'), initialHtml, markers, signalToMarkers, declName: declOutputName };
}
