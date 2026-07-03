// Minimal build-time runtime: signal()/derived() calls are executed on Node
// during compilation to discover reactive state (see docs/adr/0001-first-milestone.md).
// `declId` is injected by the compiler for build-time discovery only; it is not
// part of the public signal/derived API surface used by component authors.

export const registry = new Map();

export function signal(initial, declId) {
  let value = initial;
  function accessor(...args) {
    if (args.length === 0) return value;
    value = args[0];
    return value;
  }
  if (declId) registry.set(declId, { kind: 'signal' });
  return accessor;
}

export function derived(compute, declId) {
  if (declId) registry.set(declId, { kind: 'derived' });
  return compute;
}

// Generic DOM glue shared by every compiled component: paint the baked initial
// HTML once, then cache every marker element and conditional anchor so
// generated update_* functions never have to search the DOM again.
export function mount(container, html) {
  container.innerHTML = html;
  const markers = new Map();
  const anchors = new Map();
  collectReactive(container, markers, anchors);
  return { markers, anchors };
}

// A structural (conditional) unit is marked by an always-present comment
// anchor (`<!--m2-->`); the element(s) actually shown after it come and go.
// These two walks are how a freshly mounted/inserted subtree's markers and
// anchors get registered or forgotten - reused by both the initial mount()
// and every generated conditional swap.
export function collectReactive(root, markers, anchors) {
  if (root.nodeType === 1 && root.hasAttribute('data-iris-id')) markers.set(root.getAttribute('data-iris-id'), root);
  else if (root.nodeType === 8 && root.data) anchors.set(root.data, root);
  for (const child of root.childNodes ?? []) collectReactive(child, markers, anchors);
}

export function forgetReactive(root, markers, anchors) {
  if (root.nodeType === 1 && root.hasAttribute('data-iris-id')) markers.delete(root.getAttribute('data-iris-id'));
  else if (root.nodeType === 8 && root.data) anchors.delete(root.data);
  for (const child of root.childNodes ?? []) forgetReactive(child, markers, anchors);
}

// Comment nodes don't support insertAdjacentHTML (Element-only), so a
// contextual fragment + ChildNode#after (which Comment does implement) is
// the vanilla-JS way to paint HTML right after an anchor.
export function insertAfter(anchor, html) {
  anchor.after(anchor.ownerDocument.createRange().createContextualFragment(html));
}

// Same contextual-fragment trick, but detached - for building a single new
// keyed list item element on demand instead of inserting it in place.
export function htmlToNode(html, ownerDocument) {
  return ownerDocument.createRange().createContextualFragment(html).firstChild;
}
