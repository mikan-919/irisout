// 最終 codegen:コンパイラが収集した結果(フラット化された宣言文、マーカー、
// signal->marker 依存グラフ)から、mountComponent() とルート signal ごとの
// update_<name>() を持つ1つの ES モジュールを組み立てる。
// ここは文字列組み立てのみ - AST もコンパイラ状態も触らない。

import { innerTemplateSource, embedBranch } from './template.js';

export function generateModule({ declStatements, markers, signalToMarkers, declOutputName, initialHtml, handlers = [] }) {
  const conditionalMarkers = markers.filter((m) => m.kind === 'conditional');
  const listMarkers = markers.filter((m) => m.kind === 'list');

  const outLines = [];
  outLines.push("import { signal, derived, mount, collectReactive, forgetReactive, insertAfter, htmlToNode } from '../src/runtime.js';", '');
  outLines.push(...declStatements.map((s) => `export ${s}`), '');
  // ハンドラは「ユーザーの式を呼んでから、書き込んだ signal に対応する
  // update_* を呼ぶ」薄いラッパー。update_* は関数宣言なので巻き上げにより
  // ここでの前方参照は安全 - このラッパー自体は mount 後にしか呼ばれない。
  for (const h of handlers) {
    const updateCalls = h.updateNames.map((name) => `update_${name}();`).join(' ');
    outLines.push(`const __handler_${h.markerId}_${h.eventName} = (...__args) => { (${h.rendered})(...__args); ${updateCalls} };`);
  }
  if (handlers.length > 0) outLines.push('');
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
    ...handlers.map((h) => `  __markers__.get(${JSON.stringify(h.markerId)}).addEventListener(${JSON.stringify(h.eventName)}, __handler_${h.markerId}_${h.eventName});`),
    '}',
    ''
  );

  for (const [signalId, markerIds] of signalToMarkers) {
    const name = declOutputName.get(signalId);
    outLines.push(`export function update_${name}() {`);
    for (const mId of markerIds) {
      const marker = markers.find((m) => m.id === mId);
      if (marker.kind === 'conditional') {
        outLines.push(
          '  {',
          `    const __next = ${marker.conditionCode};`,
          `    if (__next !== __cond_${marker.id}) {`,
          `      const __anchor = __anchors__.get(${JSON.stringify(marker.id)});`,
          '      forgetReactive(__anchor.nextSibling, __markers__, __anchors__);',
          '      __anchor.nextSibling.remove();',
          `      insertAfter(__anchor, __next ? ${embedBranch(marker.truthyHtml)} : ${embedBranch(marker.falsyHtml)});`,
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

  return outLines.join('\n');
}
