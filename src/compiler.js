// マイルストーン 1-5 のコンパイラ:式の依存解析、props 伝播、コンポーネント
// 境界のインライン化、構造更新(条件分岐と keyed リスト)
// (docs/adr/0001-first-milestone.md)。
//
// パイプライン:
//   1. @babel/parser でソースを parse(静的 AST)。
//   2. トップレベルのコンポーネント関数をすべて列挙し、他から JSX タグとして
//      一度も参照されないものをルートとする(スコープ:ルートはちょうど1つ)。
//   3. ルートの render ツリーを深さ優先で辿る。`<Child prop={expr} />` の
//      参照は再帰的にコンパイルされ、同じフラットな宣言・マーカーのリストに
//      合流する - これこそがインライン化:codegen が走る時点では元の
//      コンポーネント境界の痕跡はなく、共有スコープが1つあるだけ。
//      インスタンス化サイトごとに固有の instanceId を振るので、同じ
//      コンポーネントを2回使っても(`<Row n={1}/><Row n={2}/>`)、同じ宣言の
//      ソース位置で衝突せず、完全に独立した signal が2組できる。
//        - prop の値が追跡済み signal/derived の裸の読み取り(例 `count()`、
//          追加の計算なし)なら、子の `prop('x')` はその同じ declId への
//          エイリアスになる。別のストレージは無いので、どちら側からの
//          書き込みも両側から見える - 「props 伝播」(と write-back)は
//          自動的に成立する。
//        - それ以外(リテラルや計算を含む式)は、子の `prop('x')` を独立した
//          `signal(expr)` に昇格する。
//   4. インスタンスは1つのフラット化された出力スコープを共有するため、
//      識別子が衝突しうる(2つのインスタンスが両方 `n` を宣言するなど)。
//      すべての signal/derived/昇格 prop に hygienic な出力名(`n`、次は
//      `n$1`、…)を割り当て、それを読む式の参照は使用箇所すべてで出力名に
//      書き換える - コンポーネント境界を跨いでも同様。
//   5. フラット化・計装済みスクリプトを Node 上で1回実行し、(a) タグ付けした
//      呼び出しサイトが本当に signal/derived であることを確認し(ADR 決定
//      #3)、(b) 実際の初期 HTML をタダで得る。
//   6. 依存グラフ(marker -> signal、derived 経由・インスタンス跨ぎ)を構築し、
//      ルート signal ごとに専用の `update_<name>` 関数を生成する。その関数が
//      その signal に依存するすべてのマーカーを更新する。
//
// 条件レンダリング(`cond && <A/>` や `cond ? <A/> : <B/>`)は別*種*の
// マーカー:「構造」ユニット。ブランチは実マークアップなので textContent の
// 差し替えでは済まず、要素の属性ではなく常に存在するコメントアンカー
// (`<!--m2-->`)を持つ - コメントなら何も描画されていない間も生き残る。
// 何も描画しないブランチ(null/false、または単に非アクティブな側)は空の
// `<!---->` プレースホルダとして焼き込まれるので、アンカーの直後には常に
// ちょうど1つの兄弟ノードがあり、もう一方のブランチをマウントする前に
// それを破棄すればよい。ブランチ自身のリアクティブなマーカー/アンカーは
// コンパイル時に追跡せず、実行時に汎用的に発見する(runtime.js の
// collectReactive/forgetReactive 参照)ので、ブランチ内に任意にネストした
// リアクティブ内容やさらなる条件分岐も自動的に扱える。
//
// keyed リスト(`items().map(item => <li key={item.id}>{item.name}</li>)`)は
// 第3のマーカーで、同じくコメントでアンカーされるが、アイテム数が変わるので
// *範囲*(`<!--m3_start-->`...`<!--m3_end-->`)になる。更新時の
// リコンシリエーションは意図的に素朴:新しい配列を順に辿り、既に要素を持つ
// key はその要素を再利用し(アイテム自身のフィールドは追跡 signal ではない
// ので内容は丸ごと再描画)、新しい key には要素を作成し、すべてを新しい
// 順序で `insertBefore(el, end)` する - 文書内に既に存在するノードの挿入は
// *移動*になるため、insertBefore の繰り返しが並べ替えを兼ねる。これは
// 移動回数最適ではない(LIS ベースの最小移動 diff なし)が、見落としでは
// なく意図的な先送り - docs/adr/0001-first-milestone.md 参照。
//
// スコープ制限(隠さず明記):単一ファイル(コンポーネントのクロスモジュール
// import なし)、非リストの JSX 参照は静的インスタンス1つずつ、リスト
// アイテムのテンプレートはテキスト/式のみ(ネストした要素・条件分岐・
// さらなるリストは不可、アイテム自身のフィールド外の signal へのアクセスも
// 不可)、hygienic リネームは signal/derived/prop 宣言のみ対象 -
// 非リアクティブなローカル(`const step = 2`)はそのまま残り、インスタンス間で
// 衝突しうる。

import { parse } from '@babel/parser';
import traverseImport from '@babel/traverse';
import { signal, derived, registry } from './runtime.js';
import { escapeTemplateText, innerTemplateSource, embedBranch } from './template.js';
import { classifyConditionalExpr, classifyListExpr, classifyStructuralExpr, renderItemTemplate } from './classify.js';
import { generateModule } from './codegen.js';

const traverse = traverseImport.default ?? traverseImport;

export function compile(source) {
  registry.clear();

  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const sliceSrc = (path) => source.slice(path.node.start, path.node.end);

  // key: `${instanceId}:${declaratorStart}` -> declId。同じ declarator ノードは
  // コンポーネントのインスタンスごとに再訪されるので複合キーにしている。
  const declIdByKey = new Map();
  const declKind = new Map(); // declId -> 'signal' | 'derived'
  const declOutputName = new Map(); // declId -> hygienic な出力識別子
  const derivedDeps = new Map(); // declId -> Set<declId>
  const usedOutputNames = new Set();
  const markers = []; // { id, contentParts }
  const markerDeps = new Map(); // markerId -> Set<declId>(直接依存、推移閉包を取る前)
  const handlers = []; // { markerId, eventName, rendered, writeDeclIds }(signalToMarkers 確定後に updateNames へ変換)
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

  // declarator に declId を採番・登録し、plain / instrumented の
  // `const <name> = <kind>(<arg>)` 出力ペアを emit する。
  // signal/derived 宣言と prop 昇格の両方から使う。
  function emitReactiveDecl(instanceId, declaratorStart, naturalName, kind, argSrc, out) {
    const declId = `decl_${instanceId}_${declaratorStart}`;
    declIdByKey.set(declKey(instanceId, declaratorStart), declId);
    declKind.set(declId, kind);
    const outputName = assignOutputName(naturalName, declId);
    out.declStatements.push(`const ${outputName} = ${kind}(${argSrc});`);
    out.instrumentedDeclStatements.push(`const ${outputName} = ${kind}(${argSrc}, ${JSON.stringify(declId)});`);
    return declId;
  }

  // 式を走査し、参照されている各識別子をレキシカルスコープ経由で追跡中の
  // declId(あれば)に解決して、依存の集合と、それらの参照を hygienic な
  // 出力名に書き換えたソーステキストの両方を返す(リネーム不要なら実質
  // no-op)。
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

  // ハンドラ式(`onClick={...}`)専用の解析:読み取りは analyzeExpr と同じく
  // hygienic な出力名にリネームしつつ、式中の「追跡済み signal への引数あり
  // 呼び出し」を書き込みとして検出する。`count(count() + 1)` のように同じ
  // signal への読み書きが同居しても、外側の呼び出し(引数あり = 書き込み)
  // だけを拾うので二重登録にはならない。
  function analyzeHandlerExpr(exprPath, instanceId) {
    const { rendered } = analyzeExpr(exprPath, instanceId);
    const writeDeclIds = new Set();
    const visitCall = (callPath) => {
      if (callPath.node.arguments.length < 1) return;
      const callee = callPath.get('callee');
      if (!callee.isIdentifier()) return;
      const binding = callee.scope.getBinding(callee.node.name);
      if (!binding || binding.path.node.type !== 'VariableDeclarator') return;
      const declId = declIdByKey.get(declKey(instanceId, binding.path.node.start));
      if (!declId) return;
      if (declKind.get(declId) === 'derived') {
        throw new Error(`compile: cannot write to derived "${callee.node.name}"`);
      }
      for (const sig of resolveToSignals(declId, new Set())) writeDeclIds.add(sig);
    };
    if (exprPath.isCallExpression()) visitCall(exprPath);
    exprPath.traverse({ CallExpression: visitCall });
    return { rendered, writeDeclIds };
  }

  // ホスト要素の openingElement から `on[A-Z]...` 属性を集めてハンドラ解析
  // する。構造ユニット(条件分岐ブランチ)内にあるハンドラはブランチが
  // innerHTML 的に丸ごと差し替わり listener が失われるため、スコープ制限
  // として明示的にエラーにする - アップグレード経路は
  // docs/adr/0002-event-handlers.md 参照。
  function collectHandlerAttrs(openingElementPath, instanceId, inStructural) {
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
      const { rendered, writeDeclIds } = analyzeHandlerExpr(attr.get('value.expression'), instanceId);
      result.push({ eventName, rendered, writeDeclIds });
    }
    return result;
  }

  // handlerAttrs を `handlers` に確定登録する。markerId は呼び出し側が
  // (既存のテキストマーカー流用 or 新規採番のどちらかで)決めて渡す。
  function registerHandlers(markerId, handlerAttrs) {
    for (const h of handlerAttrs) {
      handlers.push({ markerId, eventName: h.eventName, rendered: h.rendered, writeDeclIds: h.writeDeclIds });
    }
  }

  // `count()` のような裸の読み取り - 追跡済み signal/derived の引数なし
  // 呼び出しで周囲に計算がないもの - は安全にエイリアスできる。それ以外
  // (リテラル、`count() + 1` など)は一般に write-back できないので、
  // 独立した signal に昇格する。
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
          const argPath = stmt.get('declarations.0.init.arguments.0');
          const { deps, rendered } = analyzeExpr(argPath, instanceId);
          const declId = emitReactiveDecl(instanceId, declarator.start, declarator.id.name, kind, rendered, out);
          if (kind === 'derived') derivedDeps.set(declId, deps);
          return;
        }

        if (kind === 'prop') {
          const propName = init.arguments[0].value;
          const binding = propBindings.get(propName);
          if (!binding) throw new Error(`compile: no value passed for prop "${propName}"`);

          if (binding.mode === 'alias') {
            declIdByKey.set(declKey(instanceId, declarator.start), binding.declId);
            // 既存 signal と同じ declId - 新しいストレージも宣言も不要。
            // 以降の参照はすべてそこへ直接解決される。
          } else {
            emitReactiveDecl(instanceId, declarator.start, declarator.id.name, 'signal', binding.rendered, out);
          }
          return;
        }
      }
    }
    // 非リアクティブなローカル(例 `const step = 2;`)- そのまま残し、
    // hygienic リネームはしない(上記スコープ制限参照)。
    out.declStatements.push(sliceSrc(stmt));
    out.instrumentedDeclStatements.push(sliceSrc(stmt));
  }

  // ブランチが描画するのは JSX 要素か、無(null リテラルまたは `false`)。
  // ブランチの中身は常に構造ユニット配下(inStructural=true)として扱う -
  // スワップのたびに丸ごと作り直されるため。
  function renderBranch(branchPath, componentsByName, instanceId, out) {
    if (!branchPath) return null;
    if (branchPath.isJSXElement()) return renderElement(branchPath, componentsByName, instanceId, out, true);
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

    return `<!--${markerId}-->\${${conditionCode} ? ${embedBranch(truthyHtml)} : ${embedBranch(falsyHtml)}}`;
  }

  function renderList(exprPath, instanceId) {
    const cls = classifyListExpr(exprPath);
    const { deps, rendered: listCode } = analyzeExpr(cls.listExprPath, instanceId);
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
    const { tagName, keyExprSrc, innerSrc } = renderItemTemplate(cls.templatePath, source);
    const markerId = `m${markerCounter++}`;

    markers.push({ id: markerId, kind: 'list', listCode, itemParamName: cls.itemParamName, tagName, keyExprSrc, innerSrc });
    markerDeps.set(markerId, deps);

    const itemHtml = `<${tagName}>${innerSrc}</${tagName}>`;
    return `<!--${markerId}_start-->\${${listCode}.map((${cls.itemParamName}) => \`${itemHtml}\`).join('')}<!--${markerId}_end-->`;
  }

  // JSXText/式の子の連なりを、1回の textContent 置換で更新するアトミックな
  // ユニットとして扱う:マーカーを登録し、内側のテンプレートソースを返す。
  // renderChildren の run と要素まるごとマーカーの両方から使う。
  function buildTextMarker(runPaths, instanceId) {
    const markerId = `m${markerCounter++}`;
    const contentParts = [];
    const deps = new Set();
    for (const p of runPaths) {
      if (p.isJSXText()) {
        contentParts.push({ type: 'text', value: p.node.value });
      } else if (p.isJSXExpressionContainer()) {
        const { deps: exprDeps, rendered } = analyzeExpr(p.get('expression'), instanceId);
        contentParts.push({ type: 'expr', code: rendered });
        for (const d of exprDeps) deps.add(d);
      } else {
        throw new Error('compile: mixing elements into a reactive text unit is not supported yet (scope limit)');
      }
    }
    markers.push({ id: markerId, kind: 'text', contentParts });
    markerDeps.set(markerId, deps);
    return { markerId, inner: innerTemplateSource(contentParts) };
  }

  // 直接の子に条件分岐/リストを1つ以上含むホスト要素の子の処理:内容の
  // 一部が構造ユニットになるため、単純なテキストマーカーの場合と違い、
  // 要素自体を1回の textContent 置換ユニットにはできない。静的テキスト/
  // 単純式の連なりは引き続きまとめて自前のテキストマーカーになるが、
  // 自分を包む要素を持たない裸の連なりには、クエリ可能な足場として
  // 合成の <span> を付ける。
  function renderChildren(childrenPaths, componentsByName, instanceId, out, inStructural) {
    let result = '';
    let run = [];
    const flushRun = () => {
      if (run.length === 0) return;
      const hasExpr = run.some((p) => p.isJSXExpressionContainer());
      if (!hasExpr) {
        for (const p of run) result += escapeTemplateText(p.node.value);
      } else {
        const { markerId, inner } = buildTextMarker(run, instanceId);
        result += `<span data-iris-id="${markerId}">${inner}</span>`;
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
        result += renderElement(child, componentsByName, instanceId, out, inStructural);
      } else {
        throw new Error(`compile: unsupported JSX child <${child.node.type}> (scope limit)`);
      }
    }
    flushRun();
    return result;
  }

  function renderElement(elementPath, componentsByName, instanceId, out, inStructural) {
    const tagName = elementPath.node.openingElement.name.name;

    if (/^[A-Z]/.test(tagName)) {
      const childPath = componentsByName.get(tagName);
      if (!childPath) throw new Error(`compile: unknown component <${tagName}>`);
      const propBindings = buildPropBindings(elementPath.get('openingElement'), instanceId);
      const childInstanceId = instanceCounter++;
      return compileComponent(childPath, propBindings, childInstanceId, componentsByName, out, inStructural);
    }

    const handlerAttrs = collectHandlerAttrs(elementPath.get('openingElement'), instanceId, inStructural);

    const children = elementPath.get('children');
    const hasStructural = children.some((c) => c.isJSXExpressionContainer() && classifyStructuralExpr(c.get('expression')));
    if (hasStructural) {
      const inner = renderChildren(children, componentsByName, instanceId, out, inStructural);
      if (handlerAttrs.length === 0) return `<${tagName}>${inner}</${tagName}>`;
      const markerId = `m${markerCounter++}`;
      registerHandlers(markerId, handlerAttrs);
      return `<${tagName} data-iris-id="${markerId}">${inner}</${tagName}>`;
    }

    const hasDirectExpr = children.some((c) => c.isJSXExpressionContainer());

    if (!hasDirectExpr) {
      let inner = '';
      for (const child of children) {
        if (child.isJSXText()) inner += escapeTemplateText(child.node.value);
        else if (child.isJSXElement()) inner += renderElement(child, componentsByName, instanceId, out, inStructural);
        else throw new Error(`compile: unsupported JSX child <${child.node.type}> (scope limit)`);
      }
      if (handlerAttrs.length === 0) return `<${tagName}>${inner}</${tagName}>`;
      const markerId = `m${markerCounter++}`;
      registerHandlers(markerId, handlerAttrs);
      return `<${tagName} data-iris-id="${markerId}">${inner}</${tagName}>`;
    }

    const { markerId, inner } = buildTextMarker(children, instanceId);
    if (handlerAttrs.length > 0) registerHandlers(markerId, handlerAttrs);
    return `<${tagName} data-iris-id="${markerId}">${inner}</${tagName}>`;
  }

  function compileComponent(componentPath, propBindings, instanceId, componentsByName, out, inStructural) {
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
    return renderElement(returnArgPath, componentsByName, instanceId, out, inStructural);
  }

  // --- トップレベルのコンポーネントをすべて列挙し、誰からも参照されない唯一のルートを特定する ---
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
  const rootHtmlSource = compileComponent(rootPath, new Map(), instanceCounter++, componentsByName, out, false);

  // --- 推移閉包:derived の declId をルート signal まで展開する ---
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

  // --- ビルド時実行:discovery の確認 + 実際の初期 HTML の取得 ---
  const instrumentedBody = [...out.instrumentedDeclStatements, `return \`${rootHtmlSource}\`;`].join('\n');
  const runComponent = new Function('signal', 'derived', instrumentedBody);
  const initialHtml = runComponent(signal, derived);

  for (const [declId, kind] of declKind) {
    const entry = registry.get(declId);
    if (!entry || entry.kind !== kind) {
      throw new Error(`compile: expected "${declOutputName.get(declId)}" to be a ${kind}() call (ADR-0001 #3 discovery check)`);
    }
  }

  // --- ハンドラの書き込み先 declId を、マーカーを持つルート signal のみに
  //     絞って出力名へ変換する(signalToMarkers はここまでで確定)。
  //     マーカーの無い signal への update_* は codegen で生成されない
  //     ので、そこへの呼び出しは省く。
  for (const h of handlers) {
    h.updateNames = [...h.writeDeclIds]
      .filter((id) => signalToMarkers.has(id))
      .map((id) => declOutputName.get(id))
      .sort();
    delete h.writeDeclIds;
  }

  // --- codegen:ルート signal ごとの専用 update_<name>()、コンポーネント/インスタンス境界を跨ぐ ---
  const code = generateModule({ declStatements: out.declStatements, markers, signalToMarkers, declOutputName, initialHtml, handlers });

  return { code, initialHtml, markers, signalToMarkers, declName: declOutputName };
}
